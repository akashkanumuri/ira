import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Lock, MessageSquare, Send } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { isMissingSchema } from '../../lib/tasks';
import { notify } from '../../lib/toast';
import { cx } from '../../ui';

interface Comment { id: string; author_id: string | null; author_kind: 'client' | 'staff'; author_name: string | null; body: string; visibility: 'client' | 'internal'; created_at: string }

const db = supabase as any;
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Discussion on one deliverable. Staff may add internal notes; clients only ever see client-visible comments (enforced by RLS). */
export function DeliverableThread({ deliverableId, staff }: { deliverableId: string; staff: boolean }) {
  const [items, setItems] = useState<Comment[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable' | 'error'>('loading');
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [me, setMe] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const { data, error } = await db.from('deliverable_comments').select('id, author_id, author_kind, author_name, body, visibility, created_at')
      .eq('deliverable_id', deliverableId).is('deleted_at', null).order('created_at');
    if (error) { setState(isMissingSchema(error) ? 'unavailable' : 'error'); return; }
    setItems(data ?? []);
    setState('ready');
  }, [deliverableId]);
  useEffect(() => { void load(); void supabase.auth.getUser().then(({ data }) => setMe(data.user?.id ?? null)); }, [load]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [items.length]);

  async function send() {
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    try {
      const { error } = await db.rpc('deliverable_add_comment', { p_deliverable_id: deliverableId, p_body: text, p_internal: staff && internal });
      if (error) throw new Error(error.message);
      setBody('');
      await load();
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Unable to post the comment.', 'error');
    } finally {
      setBusy(false);
    }
  }

  if (state === 'unavailable') return <p className="text-xs text-ink-400">Discussion switches on once the collaboration database update is applied.</p>;

  return (
    <section>
      <h3 className="text-[13px] font-semibold mb-3 flex items-center gap-1.5 text-ink-900"><MessageSquare size={14} /> Discussion</h3>
      {state === 'loading' && <div className="skeleton h-12 rounded-2xl" />}
      {state === 'error' && <p className="text-xs text-rose-600">Couldn’t load the discussion.</p>}
      {state === 'ready' && (
        <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
          {items.length === 0 && <p className="text-xs text-ink-400">No comments yet. {staff ? 'Replies you post here reach the client as “IRA team” unless you mark them internal.' : 'Ask a question or leave feedback for the IRA team.'}</p>}
          {items.map((c) => {
            const mine = c.author_id === me;
            return (
              <div key={c.id} className={cx('flex', mine ? 'justify-end' : 'justify-start')}>
                <div className={cx('max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed',
                  c.visibility === 'internal' ? 'bg-amber-50 border border-amber-100 text-amber-900' : mine ? 'bg-brand-600 text-white' : 'bg-ink-50 text-ink-800')}>
                  <p className={cx('text-[11px] font-semibold mb-0.5 flex items-center gap-1', c.visibility === 'internal' ? 'text-amber-700' : mine ? 'text-white/80' : 'text-ink-500')}>
                    {c.visibility === 'internal' && <Lock size={10} />}
                    {mine ? 'You' : c.author_name ?? (c.author_kind === 'client' ? 'Client' : 'IRA team')}
                    {c.author_kind === 'client' && !mine && staff && <span className="font-normal">· client</span>}
                    <span className="font-normal opacity-80">· {when(c.created_at)}</span>
                  </p>
                  <p className="whitespace-pre-line break-words">{c.body}</p>
                </div>
              </div>
            );
          })}
          <div ref={end} />
        </div>
      )}
      {state === 'ready' && (
        <div className="mt-3">
          <div className="flex items-end gap-2">
            <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} rows={2}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); } }}
              placeholder={staff ? (internal ? 'Internal note — only your team sees this' : 'Reply to the client…') : 'Write a comment for the IRA team…'}
              className="input flex-1 !min-h-[44px] resize-none" aria-label="Comment" />
            <button type="button" onClick={() => void send()} disabled={busy || !body.trim()} className="btn-primary !h-11 !w-11 !p-0 shrink-0 disabled:opacity-50" aria-label="Send comment"><Send size={16} /></button>
          </div>
          {staff && (
            <label className="mt-2 inline-flex items-center gap-2 text-[12px] text-ink-600"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} className="accent-[var(--brand)]" /> Internal note (hidden from the client)</label>
          )}
        </div>
      )}
    </section>
  );
}
