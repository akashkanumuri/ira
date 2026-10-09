// Supabase Edge Function: send-push
// Server-Side Web Push Dispatcher with VAPID Authentication, Role-based Authorization & Lifecycle Pruning
import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// In-memory sliding-window rate limiting map: callerId -> array of timestamps (ms)
const rateLimitMap = new Map<string, number[]>()
const RATE_LIMIT_WINDOW_MS = 60_000
const MAX_REQUESTS_PER_WINDOW = 20

function isRateLimited(userId: string): boolean {
  const now = Date.now()
  const timestamps = (rateLimitMap.get(userId) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS)
  if (timestamps.length >= MAX_REQUESTS_PER_WINDOW) {
    return true
  }
  timestamps.push(now)
  rateLimitMap.set(userId, timestamps)

  // Periodic pruning of stale keys to avoid unbounded memory growth in long-running containers
  if (rateLimitMap.size > 500) {
    for (const [key, times] of rateLimitMap.entries()) {
      if (times.every((t) => now - t >= RATE_LIMIT_WINDOW_MS)) {
        rateLimitMap.delete(key)
      }
    }
  }
  return false
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('[send-push] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
      return new Response(JSON.stringify({ error: 'Server configuration error' }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Verify VAPID configuration: first check environment secrets, fallback to secure internal store
    let vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY') || ''
    const vapidPublicKey =
      Deno.env.get('VAPID_PUBLIC_KEY') ||
      'BNWjdwx1DlkshpNNLzmJKNfIEpySs_Yru1_smlmVUuk3yLdUlpvcAjf3NWwwffSh0QquTUKgPZwtsZic4N23KR0'
    const vapidSubject = Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@ira-presence.local'

    if (!vapidPrivateKey) {
      const { data: vaultKey } = await supabase.rpc('get_vapid_private_key')
      if (vaultKey) {
        vapidPrivateKey = vaultKey
      }
    }

    if (!vapidPrivateKey) {
      console.error('[send-push] VAPID_PRIVATE_KEY is not configured')
      return new Response(JSON.stringify({ error: 'Push notification service not configured' }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)

    // 1. Authenticate caller token
    const token = authHeader.replace(/^Bearer\s+/i, '')
    const { data: userData, error: userError } = await supabase.auth.getUser(token)
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized caller token' }), {
        status: 401,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    const callerId = userData.user.id

    // 2. Abuse protection: Rate limiting per caller
    if (isRateLimited(callerId)) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded. Please wait before sending more alerts.' }), {
        status: 429,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    // 3. Parse and sanitize payload
    const body = await req.json().catch(() => ({}))
    const { recipientId, notificationId } = body
    let { title, body: messageBody, actionUrl } = body

    if (!recipientId || typeof recipientId !== 'string' || !UUID_REGEX.test(recipientId)) {
      return new Response(JSON.stringify({ error: 'Valid recipientId UUID is required' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    if (notificationId && (typeof notificationId !== 'string' || !UUID_REGEX.test(notificationId))) {
      return new Response(JSON.stringify({ error: 'Invalid notificationId UUID format' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    // 4. Role-based authorization & spoofing protection
    const { data: callerProfile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', callerId)
      .maybeSingle()
    const isCallerAdmin = callerProfile?.role === 'admin'

    let referencedNotification: any = null

    if (!isCallerAdmin) {
      // Non-admins can only:
      // Case A: Send a test alert to their own devices
      const isSelfTest = recipientId === callerId

      if (isSelfTest) {
        title = String(title || 'IRA Presence Test').slice(0, 100)
        messageBody = String(messageBody || 'Test alert from your device.').slice(0, 400)
        actionUrl = typeof actionUrl === 'string' && actionUrl.startsWith('/') ? actionUrl.slice(0, 200) : '/'
      } else if (notificationId) {
        // Case B: Dispatch push backed by a verified database notification where caller is actor
        const { data: dbNotif, error: notifError } = await supabase
          .from('notifications')
          .select('id, recipient_id, actor_id, title, message, action_url, metadata')
          .eq('id', notificationId)
          .maybeSingle()

        if (notifError || !dbNotif) {
          return new Response(JSON.stringify({ error: 'Referenced notification record not found' }), {
            status: 404,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          })
        }

        if (dbNotif.actor_id !== callerId || dbNotif.recipient_id !== recipientId) {
          return new Response(
            JSON.stringify({ error: 'Caller is not authorized to dispatch this notification' }),
            { status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
          )
        }

        // Idempotency check: prevent replaying pushes for an already-pushed event
        if ((dbNotif.metadata as any)?.pushed_at) {
          return new Response(
            JSON.stringify({ success: true, message: 'Push notification already dispatched for this event', delivered: 0 }),
            { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
          )
        }

        referencedNotification = dbNotif

        // Use database verified content to prevent employee payload spoofing
        title = dbNotif.title
        messageBody = dbNotif.message
        actionUrl = dbNotif.action_url || '/'
      } else {
        return new Response(
          JSON.stringify({
            error: 'Forbidden: Non-administrators can only dispatch verified notifications or self-test alerts.',
          }),
          { status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
        )
      }
    } else {
      // Admin caller: sanitize inputs
      title = String(title || 'IRA Presence Notification').slice(0, 120)
      messageBody = String(messageBody || 'You have a new update.').slice(0, 500)
      actionUrl = typeof actionUrl === 'string' && actionUrl.startsWith('/') ? actionUrl.slice(0, 200) : '/'

      if (notificationId) {
        const { data: dbNotif } = await supabase
          .from('notifications')
          .select('id, recipient_id, actor_id, title, message, action_url, metadata')
          .eq('id', notificationId)
          .maybeSingle()
        if (dbNotif) {
          referencedNotification = dbNotif
        }
      }
    }

    // 5. Query registered push subscriptions for recipient
    const { data: subscriptions, error: subError } = await supabase
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('user_id', recipientId)

    if (subError) {
      console.error('[send-push] Subscription query error:', subError.message)
      return new Response(JSON.stringify({ error: 'Failed to query recipient subscriptions' }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    if (!subscriptions || subscriptions.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'No registered push devices for user', delivered: 0 }),
        { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      )
    }

    const payload = JSON.stringify({
      title,
      body: messageBody,
      action_url: actionUrl,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      timestamp: Date.now(),
    })

    let delivered = 0
    let pruned = 0

    // 6. Dispatch push and prune expired subscriptions
    for (const sub of subscriptions) {
      const pushConfig = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.p256dh,
          auth: sub.auth,
        },
      }

      try {
        await webpush.sendNotification(pushConfig, payload, { TTL: 86400 })
        delivered++
      } catch (err: any) {
        console.warn(`[WebPush] Delivery failure for subscription ${sub.id}:`, err?.statusCode || err?.message)
        // HTTP 404 Not Found or 410 Gone indicates subscription has expired or was revoked
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await supabase.from('push_subscriptions').delete().eq('id', sub.id)
          pruned++
        }
      }
    }

    // Record pushed_at in database notification to enforce idempotency
    if (referencedNotification && delivered > 0) {
      try {
        const currentMeta = (referencedNotification.metadata as any) || {}
        await supabase
          .from('notifications')
          .update({
            metadata: {
              ...currentMeta,
              pushed_at: new Date().toISOString(),
              pushed_count: ((currentMeta.pushed_count as number) || 0) + 1,
            },
          })
          .eq('id', referencedNotification.id)
      } catch (metaErr) {
        console.warn('[send-push] Failed to update notification pushed_at metadata:', metaErr)
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        delivered,
        pruned,
        totalDevices: subscriptions.length,
      }),
      { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    console.error('[WebPush] Unexpected dispatch error:', err?.message)
    return new Response(JSON.stringify({ error: 'Internal push dispatch error' }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }
})
