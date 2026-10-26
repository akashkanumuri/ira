// Supabase Edge Function: push-worker
// Delivers every new row in public.notifications to the recipient's registered devices (Web Push).
// Woken by the database (pg_net, on insert) and by a once-a-minute retry tick. It never trusts the
// request body: it only claims undelivered rows from the database, so a call can't inject content.
// Auth: shared secret generated in the database (Vault) and sent as `x-push-secret`.
import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const APP_URL = (Deno.env.get('APP_URL') || 'https://ira-eta-two.vercel.app').replace(/\/$/, '')
const VAPID_PUBLIC =
  Deno.env.get('VAPID_PUBLIC_KEY') ||
  'BNWjdwx1DlkshpNNLzmJKNfIEpySs_Yru1_smlmVUuk3yLdUlpvcAjf3NWwwffSh0QquTUKgPZwtsZic4N23KR0'
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@ira-presence.local'

let hookSecret: string | null = null
let vapidReady = false

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const db = createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '', {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  if (!hookSecret) {
    const { data, error } = await db.rpc('push_hook_secret')
    if (error || !data) return json({ error: 'Push hook not configured' }, 500)
    hookSecret = data as string
  }
  if (!safeEqual(req.headers.get('x-push-secret') || '', hookSecret)) return json({ error: 'Unauthorized' }, 401)

  if (!vapidReady) {
    let priv = Deno.env.get('VAPID_PRIVATE_KEY') || ''
    if (!priv) {
      const { data } = await db.rpc('get_vapid_private_key')
      priv = (data as string) || ''
    }
    if (!priv) return json({ error: 'VAPID key not configured' }, 500)
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, priv)
    vapidReady = true
  }

  let processed = 0, delivered = 0, pruned = 0
  const started = Date.now()

  while (Date.now() - started < 25_000) {
    const { data: batch, error } = await db.rpc('claim_push_batch', { p_limit: 25 })
    if (error) return json({ error: error.message, processed }, 500)
    const rows = (batch ?? []) as Array<{ id: string; recipient_id: string; type: string; title: string; message: string; action_url: string | null }>
    if (!rows.length) break

    const recipients = [...new Set(rows.map((r) => r.recipient_id))]
    const [{ data: subs }, { data: profiles }] = await Promise.all([
      db.from('push_subscriptions').select('id, user_id, endpoint, p256dh, auth').in('user_id', recipients),
      db.from('profiles').select('id, role').in('id', recipients),
    ])
    const unread = new Map<string, number>()
    await Promise.all(recipients.map(async (rid) => {
      const { count } = await db.from('notifications').select('id', { count: 'exact', head: true }).eq('recipient_id', rid).is('read_at', null)
      unread.set(rid, count ?? 0)
    }))

    for (const n of rows) {
      processed++
      const devices = (subs ?? []).filter((s) => s.user_id === n.recipient_id)
      if (!devices.length) {
        await db.rpc('finish_push', { p_id: n.id, p_state: 'no_devices', p_delivered: 0 })
        continue
      }
      const role = (profiles ?? []).find((p) => p.id === n.recipient_id)?.role
      const icon = role === 'client' ? '/icon-192.png' : '/brand/sigma1-icon-192.png'
      const path = n.action_url && n.action_url.startsWith('/') ? n.action_url : '/'
      const badge = unread.get(n.recipient_id) ?? 0
      // Declarative Web Push shape (Safari 18.4+) plus the fields our service worker reads everywhere else.
      const payload = JSON.stringify({
        web_push: 8030,
        notification: { title: n.title, body: n.message, navigate: APP_URL + path, lang: 'en-IN', tag: `sigma-${n.id}`, app_badge: badge },
        id: n.id, type: n.type, title: n.title, body: n.message, action_url: path,
        icon, badge_icon: icon, tag: `sigma-${n.id}`, unread: badge,
      })

      let ok = 0
      let lastError: string | null = null
      await Promise.all(devices.map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
            TTL: 12 * 3600,
            urgency: n.type === 'activity' ? 'normal' : 'high',
          })
          ok++
        } catch (err: any) {
          const code = err?.statusCode
          lastError = `${code ?? ''} ${err?.body || err?.message || 'send failed'}`.trim()
          if (code === 404 || code === 410) {
            await db.from('push_subscriptions').delete().eq('id', s.id)
            pruned++
          }
        }
      }))
      delivered += ok
      const allGone = ok === 0 && lastError && /^(404|410)/.test(lastError)
      await db.rpc('finish_push', {
        p_id: n.id,
        p_state: ok > 0 ? 'sent' : allGone ? 'no_devices' : 'failed',
        p_delivered: ok,
        p_error: ok > 0 ? null : lastError,
      })
    }
  }

  return json({ processed, delivered, pruned })
})
