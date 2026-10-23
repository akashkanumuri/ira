import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Lock, Send } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { SUPPORT_STATUS, supportApi, type SupportMessage, type SupportRequest, type SupportStatus } from '../../lib/support';
import { notify } from '../../lib/toast';
import { Badge, cx } from '../../ui';

const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** One support request's messages and reply box. `staff` enables internal notes and status changes. */
export function SupportConversation({ request, staff, assignees = [], onChanged }: {
  request: SupportRequest; staff: boolean; assignees?: Array<{ id: string; name: string }>; onChanged: () => Promise<void> | void;
}) {
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [me, setMe] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try { setMessages(await supportApi.messages(request.id)); } catch (e) { notify(e instanceof Error ? e.message : 'Unable to load messages.', 'error'); }
  }, [request.id]);
  useEffect(() => { void load(); void supabase.auth.getUser().then(({ data }) => setMe(data.user?.id ?? null)); }, [load]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [messages.length]);

  async function send() {
    if (!body.trim()) return;
    setBusy(true);
    try { await supportApi.reply(request.id, body.trim(), staff && internal); setBody(''); await load(); await onChanged(); }
    catch (e) { notify(e instanceof Error ? e.message : 'Unable to send.', 'error'); }
    finally { setBusy(false); }
  }
  async function setStatus(s: SupportStatus, assignee?: string | null) {
    setBusy(true);
    try { await supportApi.setStatus(request.id, s, assignee ?? null); notify('Updated.', 'success'); await onChanged(); }
    catch (e) { notify(e instanceof Error ? e.message : 'Unable to update.', 'error'); }
    finally { setBusy(false); }
  }

  const closed = request.status === 'closed';
  return (
    <div className="flex flex-col h-full">
      {staff && (
        <div className="flex flex-wrap items-center gap-2 pb-3 border-b border-ink-100">
          <select className="input !w-auto !min-h-[36px] !text-[13px]" value={request.status} disabled={busy} onChange={(e) => void setStatus(e.target.value as SupportStatus)} aria-label="Status">
            {(Object.keys(SUPPORT_STATUS) as SupportStatus[]).map((s) => <option key={s} value={s}>{SUPPORT_STATUS[s].label}</option>)}
          </select>
          {assignees.length > 0 && (
            <select className="input !w-auto !min-h-[36px] !text-[13px]" value={request.assigned_to ?? ''} disabled={busy} onChange={(e) => e.target.value && void setStatus(request.status, e.target.value)} aria-label="Assigned to">
              <option value="">Unassigned</option>
              {assignees.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}
        </div>
      )}
      <div className="flex-1 overflow-y-auto py-4 space-y-3 min-h-[200px]">
        {messages.map((m) => {
          const mine = m.author_id === me;
          return (
            <div key={m.id} className={cx('flex', mine ? 'justify-end' : 'justify-start')}>
              <div className={cx('max-w-[85%] rounded-2xl px-4 py-3 text-[13px] leading-relaxed',
                m.internal ? 'bg-amber-50 border border-amber-100 text-amber-900' : mine ? 'bg-brand-600 text-white' : 'bg-ink-50 text-ink-800')}>
                <p className={cx('text-[11px] font-semibold mb-1 flex items-center gap-1', m.internal ? 'text-amber-700' : mine ? 'text-white/80' : 'text-ink-500')}>
                  {m.internal && <Lock size={10} />}{mine ? 'You' : m.author_name ?? (m.author_kind === 'client' ? 'Client' : 'IRA team')}
                  <span className="font-normal opacity-80">· {when(m.created_at)}</span>
                </p>
                <p className="whitespace-pre-line break-words">{m.body}</p>
              </div>
            </div>
          );
        })}
        <div ref={end} />
      </div>
      {closed ? (
        <p className="text-[13px] text-ink-500 border-t border-ink-100 pt-3">This request is closed. {staff ? '' : 'Open a new request if you need more help.'}</p>
      ) : (
        <div className="border-t border-ink-100 pt-3">
          <div className="flex items-end gap-2">
            <textarea className="input flex-1 !min-h-[48px] resize-none" rows={2} value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); } }}
              placeholder={staff ? (internal ? 'Internal note — the client won’t see this' : 'Reply to the client…') : 'Write a reply…'} aria-label="Message" />
            <button type="button" className="btn-primary !h-12 !w-12 !p-0 shrink-0 disabled:opacity-50" disabled={busy || !body.trim()} onClick={() => void send()} aria-label="Send"><Send size={16} /></button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 mt-2">
            {staff ? <label className="inline-flex items-center gap-2 text-[12px] text-ink-600"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} className="accent-[var(--brand)]" /> Internal note</label> : <span />}
            {!staff && request.status !== 'resolved' && <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => void setStatus('resolved')}>Mark as resolved</button>}
            {request.status === 'resolved' && <Badge tone="mint">Resolved</Badge>}
          </div>
        </div>
      )}
    </div>
  );
}
