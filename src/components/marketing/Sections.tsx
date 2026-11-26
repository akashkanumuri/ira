import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Ban, CheckCircle2, ExternalLink, FileSpreadsheet, FileText, ImagePlus, Megaphone, MessageSquareMore, Pencil, Plus, RotateCcw, Send, Trash2, Upload,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { notify } from '../../lib/toast';
import { ACCEPT_ATTR, openFile, uploadAndAttach } from '../../lib/sigma';
import { Badge, Button, Card, EmptyState, Notice, PillTabs, cx } from '../../ui';
import { Modal } from '../../ui/Modal';
import {
  budgetByPerson, CAMPAIGN_STATUS, OBJECTIVES, PLATFORMS, POST_STATUS, POST_TYPES, SOCIAL, errText, fmtDay, fmtWhen, inr, mkApi, moneySummary, num,
  parseResultsCsv, platformOf, resultsOf, sumResults, todayIST,
  type MkBudget, type MkCampaign, type MkClaim, type MkData, type MkMoney, type MkPost,
} from '../../lib/marketing';

export type Mode = 'admin' | 'team' | 'client';
export interface People { marketers: { id: string; name: string }[]; me: string | null; nameOf: (id: string | null | undefined) => string }
const db = () => supabase as any;
interface FileLite { id: string; parent_id: string; name: string; storage_bucket: string; storage_path: string; mime_type: string | null; created_at: string }

function useFiles(parentType: 'mk_post' | 'mk_report', ids: string[]) {
  const [files, setFiles] = useState<FileLite[]>([]);
  const key = ids.join(',');
  const load = useCallback(async () => {
    if (!ids.length) { setFiles([]); return; }
    const out: FileLite[] = [];
    for (let i = 0; i < ids.length; i += 150) {
      const { data } = await db().from('files').select('id, parent_id, name, storage_bucket, storage_path, mime_type, created_at')
        .eq('parent_type', parentType).in('parent_id', ids.slice(i, i + 150)).is('deleted_at', null).order('created_at');
      out.push(...(data ?? []));
    }
    setFiles(out);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parentType, key]);
  useEffect(() => { void load(); }, [load]);
  return { files, reload: load };
}

/** Small signed-URL thumbnail for an image creative (videos and documents show an icon). */
function Thumb({ f }: { f: FileLite }) {
  const [url, setUrl] = useState<string | null>(null);
  const isImg = (f.mime_type ?? '').startsWith('image/');
  useEffect(() => {
    if (!isImg) return;
    let alive = true;
    void supabase.storage.from(f.storage_bucket || 'sigma-files').createSignedUrl(f.storage_path, 600).then(({ data }) => { if (alive) setUrl(data?.signedUrl ?? null); });
    return () => { alive = false; };
  }, [f.storage_path, f.storage_bucket, isImg]);
  return (
    <button type="button" title={f.name} onClick={() => openFile(f, false).catch((e: unknown) => notify(errText(e, 'File not available.'), 'error'))}
      className="w-16 h-16 rounded-xl overflow-hidden border border-ink-100 bg-ink-50 grid place-items-center shrink-0 hover:ring-2 hover:ring-brand-200">
      {isImg && url ? <img src={url} alt={f.name} className="w-full h-full object-cover" /> : <span className="text-[10px] font-bold text-ink-500 uppercase px-1 truncate">{f.name.split('.').pop()}</span>}
    </button>
  );
}

const Field = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
  <label className="block"><span className="label">{label}{hint && <span className="font-normal text-ink-400 ml-1">{hint}</span>}</span>{children}</label>
);
const toLocalInput = (iso: string) => { const d = new Date(iso); const off = d.getTimezoneOffset(); return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16); };

/* ====================================================================== POSTS */

export function PostsSection({ clientId, data, mode, reload }: { clientId: string; data: MkData; mode: Mode; reload: () => Promise<void> }) {
  const [view, setView] = useState<'upcoming' | 'posted' | 'all'>('upcoming');
  const [edit, setEdit] = useState<MkPost | 'new' | null>(null);
  const [act, setAct] = useState<{ post: MkPost; kind: 'posted' | 'metrics' | 'changes' } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { files, reload: reloadFiles } = useFiles('mk_post', data.posts.map((p) => p.id));
  const team = mode !== 'client';
  const approval = !!data.settings?.post_approval;
  const shown = data.posts.filter((p) => (view === 'all' ? true : view === 'posted' ? p.status === 'posted'
    : p.status !== 'posted' && p.status !== 'cancelled'))
    .sort((a, b) => (view === 'posted' || view === 'all' ? b.scheduled_for.localeCompare(a.scheduled_for) : a.scheduled_for.localeCompare(b.scheduled_for)));
  const groups = useMemo(() => {
    const m = new Map<string, MkPost[]>();
    for (const p of shown) { const k = new Date(p.scheduled_for).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); m.set(k, [...(m.get(k) ?? []), p]); }
    return [...m.entries()];
  }, [shown]);
  const run = async (id: string, fn: () => Promise<unknown>, okMsg: string) => {
    setBusy(id);
    try { await fn(); notify(okMsg, 'success'); await reload(); } catch (e) { notify(errText(e, 'That didn’t work.'), 'error', 8000); } finally { setBusy(null); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <PillTabs size="sm" value={view} onChange={setView} items={[{ id: 'upcoming', label: 'Coming up', count: data.posts.filter((p) => p.status === 'awaiting_approval').length || undefined }, { id: 'posted', label: 'Posted' }, { id: 'all', label: 'All' }]} />
        {team && <Button size="sm" className="ml-auto" icon={<Plus className="w-4 h-4" />} onClick={() => setEdit('new')}>New post</Button>}
      </div>
      {team && approval && <p className="text-[12px] text-ink-500">This client approves posts before they go live.</p>}
      {!groups.length && <Card><EmptyState icon={<Megaphone className="w-6 h-6" />} title={view === 'posted' ? 'Nothing posted yet' : 'No posts planned'} text={team ? 'Plan posts here — date, platforms, caption and creatives.' : 'Your team’s planned posts will show here.'} className="!py-10" /></Card>}
      {groups.map(([day, posts]) => (
        <div key={day}>
          <p className="text-[12px] font-bold uppercase tracking-wide text-ink-400 mb-2">{new Date(`${day}T00:00:00+05:30`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' })}</p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {posts.map((p) => {
              const st = POST_STATUS[p.status]; const pf = files.filter((f) => f.parent_id === p.id);
              return (
                <Card key={p.id} className={cx('p-4 space-y-3', p.status === 'cancelled' && 'opacity-60')}>
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {p.platforms.map((x) => <span key={x} className="rounded-full bg-ink-50 border border-ink-100 px-2 py-0.5 text-[11px] font-semibold text-ink-700">{SOCIAL.find((s) => s.id === x)?.label ?? x}</span>)}
                        <span className="text-[11px] text-ink-500 capitalize">· {p.post_type}</span>
                      </div>
                      <p className="mt-1.5 font-semibold text-[14px] text-ink-900">{p.title || 'Untitled post'}</p>
                      <p className="text-[12px] text-ink-500">{fmtWhen(p.scheduled_for)}</p>
                    </div>
                    <Badge tone={st.tone} dot>{st.label}</Badge>
                  </div>
                  {p.caption && <p className="text-[13px] text-ink-700 whitespace-pre-line line-clamp-4">{p.caption}</p>}
                  {pf.length > 0 && <div className="flex gap-2 overflow-x-auto pb-1">{pf.map((f) => <Thumb key={f.id} f={f} />)}</div>}
                  {p.client_note && <p className={cx('text-[12.5px] rounded-xl px-3 py-2', p.status === 'changes_requested' ? 'bg-rose-50 text-rose-800' : 'bg-ink-50 text-ink-700')}><b>Client:</b> {p.client_note}</p>}
                  {p.status === 'posted' && (
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-ink-600">
                      {p.live_url && <a href={p.live_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand-700 font-semibold hover:underline"><ExternalLink className="w-3.5 h-3.5" />View live post</a>}
                      {p.reach != null && <span>Reach <b className="tnum">{num(p.reach)}</b></span>}
                      {p.likes != null && <span>Likes <b className="tnum">{num(p.likes)}</b></span>}
                      {p.comments != null && <span>Comments <b className="tnum">{num(p.comments)}</b></span>}
                      {p.shares != null && <span>Shares <b className="tnum">{num(p.shares)}</b></span>}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2 justify-end">
                    {team && ['draft', 'changes_requested', 'approved'].includes(p.status) && <button type="button" className="btn-ghost btn-sm" onClick={() => setEdit(p)}><Pencil className="w-3.5 h-3.5" />Edit</button>}
                    {team && ['draft', 'changes_requested'].includes(p.status) && (approval
                      ? <Button size="sm" variant="secondary" disabled={busy === p.id} icon={<Send className="w-3.5 h-3.5" />} onClick={() => void run(p.id, () => mkApi.postAction(p.id, 'submit'), 'Sent to the client for approval.')}>Send for approval</Button>
                      : null)}
                    {team && (p.status === 'approved' || (!approval && p.status === 'draft')) && <Button size="sm" icon={<CheckCircle2 className="w-3.5 h-3.5" />} onClick={() => setAct({ post: p, kind: 'posted' })}>Mark as posted</Button>}
                    {team && p.status === 'posted' && <button type="button" className="btn-ghost btn-sm" onClick={() => setAct({ post: p, kind: 'metrics' })}>Add numbers</button>}
                    {team && !['posted', 'cancelled'].includes(p.status) && <button type="button" className="btn-ghost btn-sm text-rose-700" disabled={busy === p.id} onClick={() => void run(p.id, () => mkApi.postAction(p.id, 'cancel'), 'Post cancelled.')}><Ban className="w-3.5 h-3.5" />Cancel</button>}
                    {team && p.status === 'cancelled' && <button type="button" className="btn-ghost btn-sm" disabled={busy === p.id} onClick={() => void run(p.id, () => mkApi.postAction(p.id, 'restore'), 'Restored as a draft.')}><RotateCcw className="w-3.5 h-3.5" />Restore</button>}
                    {mode === 'client' && p.status === 'awaiting_approval' && <>
                      <button type="button" className="btn-secondary btn-sm" onClick={() => setAct({ post: p, kind: 'changes' })}><MessageSquareMore className="w-3.5 h-3.5" />Ask for changes</button>
                      <Button size="sm" disabled={busy === p.id} icon={<CheckCircle2 className="w-3.5 h-3.5" />} onClick={() => void run(p.id, () => mkApi.postAction(p.id, 'approve'), 'Approved. The team will post it.')}>Approve</Button>
                    </>}
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      ))}
      {edit && <PostDialog clientId={clientId} post={edit === 'new' ? null : edit} files={edit === 'new' ? [] : files.filter((f) => f.parent_id === edit.id)}
        onClose={() => setEdit(null)} onSaved={async () => { await reload(); await reloadFiles(); }} />}
      {act && <PostActDialog {...act} onClose={() => setAct(null)} onDone={reload} />}
    </div>
  );
}

function PostDialog({ clientId, post, files, onClose, onSaved }: { clientId: string; post: MkPost | null; files: FileLite[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const [platforms, setPlatforms] = useState<string[]>(post?.platforms ?? ['instagram']);
  const [type, setType] = useState(post?.post_type ?? 'post');
  const [when, setWhen] = useState(post ? toLocalInput(post.scheduled_for) : toLocalInput(new Date(Date.now() + 86400000).toISOString()).slice(0, 11) + '11:00');
  const [title, setTitle] = useState(post?.title ?? ''); const [caption, setCaption] = useState(post?.caption ?? '');
  const [picked, setPicked] = useState<File[]>([]); const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const save = async () => {
    if (!platforms.length) { notify('Pick at least one platform.', 'error'); return; }
    setBusy(true);
    try {
      const id = await mkApi.savePost(post?.id ?? null, post ? null : clientId, { platforms, post_type: type, scheduled_for: new Date(when).toISOString(), title, caption });
      for (const f of picked) await uploadAndAttach(f, 'mk_post', id, { visibility: 'client' });
      notify(post ? 'Post updated.' : 'Post planned.', 'success');
      await onSaved(); onClose();
    } catch (e) { notify(errText(e, 'Could not save the post.'), 'error', 8000); } finally { setBusy(false); }
  };
  return (
    <Modal title={post ? 'Edit post' : 'Plan a post'} onClose={onClose} closeDisabled={busy} wide>
      <div className="space-y-4">
        <div>
          <p className="label">Platforms</p>
          <div className="flex flex-wrap gap-2">
            {SOCIAL.map((s) => {
              const on = platforms.includes(s.id);
              return <button key={s.id} type="button" onClick={() => setPlatforms((p) => (on ? p.filter((x) => x !== s.id) : p.length >= 6 ? p : [...p, s.id]))}
                className={cx('rounded-full px-3 py-1.5 text-[12.5px] font-semibold border', on ? 'bg-ink-950 text-white border-ink-950' : 'bg-white text-ink-600 border-ink-200 hover:border-ink-400')}>{s.label}</button>;
            })}
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Type"><select className="input capitalize" value={type} onChange={(e) => setType(e.target.value)}>{POST_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></Field>
          <Field label="Date & time"><input className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
        </div>
        <Field label="Title" hint="for your team, e.g. Diwali offer reel"><input className="input" value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Caption"><textarea className="input min-h-[120px]" value={caption} maxLength={5000} onChange={(e) => setCaption(e.target.value)} placeholder="Caption, hashtags, mentions…" /></Field>
        <div>
          <p className="label">Creatives <span className="font-normal text-ink-400 ml-1">images, videos, up to 50 MB each</span></p>
          <div className="flex flex-wrap items-center gap-2">
            {files.map((f) => <Thumb key={f.id} f={f} />)}
            {picked.map((f, i) => <span key={i} className="rounded-xl bg-brand-50 border border-brand-100 px-2.5 py-1 text-[12px] text-brand-800">{f.name}</span>)}
            <input ref={input} type="file" multiple accept={ACCEPT_ATTR} className="hidden" onChange={(e) => setPicked((p) => [...p, ...Array.from(e.target.files ?? [])].slice(0, 10))} />
            <button type="button" className="btn-secondary btn-sm" onClick={() => input.current?.click()}><ImagePlus className="w-4 h-4" />Add files</button>
          </div>
        </div>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button loading={busy} onClick={() => void save()}>{post ? 'Save' : 'Plan post'}</Button></div>
      </div>
    </Modal>
  );
}

function PostActDialog({ post, kind, onClose, onDone }: { post: MkPost; kind: 'posted' | 'metrics' | 'changes'; onClose: () => void; onDone: () => Promise<void> }) {
  const [url, setUrl] = useState(post.live_url ?? ''); const [note, setNote] = useState('');
  const [m, setM] = useState({ reach: post.reach ?? '', likes: post.likes ?? '', comments: post.comments ?? '', shares: post.shares ?? '' } as Record<string, string | number>);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      if (kind === 'changes') await mkApi.postAction(post.id, 'changes', { note });
      else await mkApi.postAction(post.id, kind, { live_url: url.trim(), ...(kind === 'metrics' ? Object.fromEntries(Object.entries(m).map(([k, v]) => [k, String(v)])) : {}) });
      notify(kind === 'changes' ? 'Sent to the team.' : kind === 'posted' ? 'Marked as posted.' : 'Numbers saved.', 'success');
      await onDone(); onClose();
    } catch (e) { notify(errText(e, 'That didn’t work.'), 'error', 8000); } finally { setBusy(false); }
  };
  return (
    <Modal title={kind === 'changes' ? 'Ask for changes' : kind === 'posted' ? 'Mark as posted' : 'Post numbers'} onClose={onClose} closeDisabled={busy}>
      <div className="space-y-4">
        {kind === 'changes'
          ? <Field label="What should change?"><textarea className="input min-h-[100px]" value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} /></Field>
          : <Field label="Link to the live post" hint="optional"><input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.instagram.com/p/…" /></Field>}
        {kind === 'metrics' && (
          <div className="grid grid-cols-2 gap-3">
            {(['reach', 'likes', 'comments', 'shares'] as const).map((k) => (
              <Field key={k} label={k[0].toUpperCase() + k.slice(1)}><input className="input text-right" type="number" min="0" value={m[k]} onChange={(e) => setM((x) => ({ ...x, [k]: e.target.value }))} /></Field>
            ))}
          </div>
        )}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose} disabled={busy}>Back</Button>
          <Button loading={busy} disabled={kind === 'changes' && note.trim().length < 3} onClick={() => void go()}>{kind === 'changes' ? 'Send' : 'Save'}</Button></div>
      </div>
    </Modal>
  );
}

/* ====================================================================== ADS */

export function AdsSection({ clientId, data, mode, reload, people }: { clientId: string; data: MkData; mode: Mode; reload: () => Promise<void>; people?: People }) {
  const [edit, setEdit] = useState<MkCampaign | 'new' | null>(null);
  const [results, setResults] = useState<MkCampaign | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const team = mode !== 'client';
  const rows = data.campaigns.map((c) => { const s = sumResults(data.results.filter((r) => r.campaign_id === c.id)); return { c, s, res: resultsOf(s) }; });
  return (
    <div className="space-y-4">
      {team && <div className="flex justify-end"><Button size="sm" icon={<Plus className="w-4 h-4" />} onClick={() => setEdit('new')}>New campaign</Button></div>}
      {!rows.length && <Card><EmptyState icon={<Megaphone className="w-6 h-6" />} title="No campaigns yet" text={team ? 'Add each ad campaign, then add its daily results or upload the Ads Manager export.' : 'Your ad campaigns will show here.'} className="!py-10" /></Card>}
      {rows.map(({ c, s, res }) => {
        const days = data.results.filter((r) => r.campaign_id === c.id).sort((a, b) => b.day.localeCompare(a.day));
        const used = c.budget ? Math.min(100, (s.spend / Number(c.budget)) * 100) : null;
        return (
          <Card key={c.id} className="p-4 sm:p-5">
            <div className="flex flex-wrap items-start gap-3">
              <span className="w-2.5 h-2.5 rounded-full mt-1.5" style={{ background: platformOf(c.platform).color }} />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-[15px] text-ink-900">{c.name}</p>
                <p className="text-[12px] text-ink-500">{platformOf(c.platform).label} · {OBJECTIVES.find((o) => o.id === c.objective)?.label} · {fmtDay(c.start_date)}{c.end_date ? ` – ${fmtDay(c.end_date)}` : ' onwards'}{team && people ? ` · run by ${c.owner_id ? people.nameOf(c.owner_id) : 'no one yet'}` : ''}</p>
              </div>
              <Badge tone={CAMPAIGN_STATUS[c.status].tone} dot>{CAMPAIGN_STATUS[c.status].label}</Badge>
            </div>
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-2">
              <Stat label="Spent" value={inr(s.spend)} sub={c.budget ? `of ${inr(c.budget)}` : undefined} />
              <Stat label="Results" value={num(res)} />
              <Stat label="Cost / result" value={res ? inr(Math.round(s.spend / res)) : '—'} />
              <Stat label="Reach" value={num(s.reach, true)} />
              <Stat label="Clicks" value={num(s.clicks, true)} sub={s.impressions ? `CTR ${((s.clicks / s.impressions) * 100).toFixed(2)}%` : undefined} />
            </div>
            {used != null && <div className="mt-3 h-1.5 rounded-full bg-ink-100 overflow-hidden"><div className={cx('h-full rounded-full', used >= 100 ? 'bg-rose-500' : used > 80 ? 'bg-amber-500' : 'bg-brand-600')} style={{ width: `${used}%` }} /></div>}
            <div className="mt-3 flex flex-wrap gap-2 justify-end">
              {days.length > 0 && <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(open === c.id ? null : c.id)}>{open === c.id ? 'Hide days' : `Show ${days.length} day${days.length === 1 ? '' : 's'}`}</button>}
              {team && <button type="button" className="btn-ghost btn-sm" onClick={() => setEdit(c)}><Pencil className="w-3.5 h-3.5" />Edit</button>}
              {team && <Button size="sm" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => setResults(c)}>Add results</Button>}
            </div>
            {open === c.id && (
              <div className="mt-3 rounded-2xl border border-ink-100 overflow-x-auto">
                <table className="data-table">
                  <thead><tr><th>Day</th><th className="text-right">Spent</th><th className="text-right">Reach</th><th className="text-right">Clicks</th><th className="text-right">Leads</th><th className="text-right">Messages</th><th className="text-right">Sales</th>{team && <th />}</tr></thead>
                  <tbody>{days.map((d) => (
                    <tr key={d.id}>
                      <td className="whitespace-nowrap">{fmtDay(d.day, true)}</td><td className="text-right tnum">{inr(d.spend)}</td><td className="text-right tnum">{num(d.reach)}</td>
                      <td className="text-right tnum">{num(d.clicks)}</td><td className="text-right tnum">{num(d.leads)}</td><td className="text-right tnum">{num(d.messages)}</td><td className="text-right tnum">{num(d.sales)}</td>
                      {team && <td><button type="button" className="icon-btn text-rose-700" title="Remove this day" onClick={() => void mkApi.removeResult(c.id, d.day).then(reload).then(() => notify('Day removed.', 'success')).catch((e: unknown) => notify(errText(e, 'Could not remove.'), 'error'))}><Trash2 className="w-3.5 h-3.5" /></button></td>}
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </Card>
        );
      })}
      {edit && <CampaignDialog clientId={clientId} c={edit === 'new' ? null : edit} admin={mode === 'admin'} marketers={people?.marketers ?? []} onClose={() => setEdit(null)} onSaved={reload} />}
      {results && <ResultsDialog c={results} onClose={() => setResults(null)} onSaved={reload} />}
    </div>
  );
}
const Stat = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
  <div className="rounded-xl bg-ink-50/70 px-3 py-2"><p className="text-[11px] text-ink-500 font-semibold">{label}</p><p className="font-display font-bold text-[16px] text-ink-950 tnum">{value}</p>{sub && <p className="text-[11px] text-ink-500">{sub}</p>}</div>
);

function CampaignDialog({ clientId, c, admin, marketers, onClose, onSaved }: { clientId: string; c: MkCampaign | null; admin: boolean; marketers: { id: string; name: string }[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const [f, setF] = useState({ owner_id: c?.owner_id ?? (admin ? marketers[0]?.id ?? '' : ''), name: c?.name ?? '', platform: c?.platform ?? 'meta', objective: c?.objective ?? 'leads', start_date: c?.start_date ?? todayIST(), end_date: c?.end_date ?? '', budget: c?.budget == null ? '' : String(c.budget), status: c?.status ?? 'running', notes: c?.notes ?? '' });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const go = async () => {
    setBusy(true);
    try { const { owner_id, ...rest } = f; await mkApi.saveCampaign(c?.id ?? null, c ? null : clientId, admin ? { ...rest, owner_id } : rest); notify(c ? 'Campaign updated.' : 'Campaign added.', 'success'); await onSaved(); onClose(); }
    catch (e) { notify(errText(e, 'Could not save.'), 'error', 8000); } finally { setBusy(false); }
  };
  return (
    <Modal title={c ? 'Edit campaign' : 'New campaign'} onClose={onClose} closeDisabled={busy}>
      <div className="space-y-4">
        <Field label="Campaign name"><input className="input" value={f.name} maxLength={160} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Nov lead gen – Hyderabad" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Platform"><select className="input" value={f.platform} onChange={(e) => set('platform', e.target.value)}>{PLATFORMS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></Field>
          <Field label="Goal"><select className="input" value={f.objective} onChange={(e) => set('objective', e.target.value)}>{OBJECTIVES.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></Field>
          <Field label="Start"><input className="input" type="date" value={f.start_date} onChange={(e) => set('start_date', e.target.value)} /></Field>
          <Field label="End" hint="optional"><input className="input" type="date" min={f.start_date} value={f.end_date} onChange={(e) => set('end_date', e.target.value)} /></Field>
          <Field label="Budget ₹" hint="optional"><input className="input" type="number" min="0" value={f.budget} onChange={(e) => set('budget', e.target.value)} /></Field>
          <Field label="Status"><select className="input" value={f.status} onChange={(e) => set('status', e.target.value)}>{Object.entries(CAMPAIGN_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
        </div>
        {admin && <Field label="Run by" hint="their ad budget pays for it"><select className="input" value={f.owner_id} onChange={(e) => set('owner_id', e.target.value)}>
          <option value="">Not assigned</option>{marketers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>}
        <Field label="Notes" hint="optional"><textarea className="input min-h-[60px]" value={f.notes} maxLength={2000} onChange={(e) => set('notes', e.target.value)} /></Field>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button loading={busy} disabled={!f.name.trim()} onClick={() => void go()}>Save</Button></div>
      </div>
    </Modal>
  );
}

const RESULT_FIELDS = [
  { k: 'spend', label: 'Spent ₹' }, { k: 'reach', label: 'Reach' }, { k: 'impressions', label: 'Views' }, { k: 'clicks', label: 'Clicks' },
  { k: 'leads', label: 'Leads' }, { k: 'messages', label: 'Messages' }, { k: 'sales', label: 'Sales' }, { k: 'sales_value', label: 'Sales ₹' },
] as const;

function ResultsDialog({ c, onClose, onSaved }: { c: MkCampaign; onClose: () => void; onSaved: () => Promise<void> }) {
  const [tab, setTab] = useState<'manual' | 'upload'>('manual');
  const [row, setRow] = useState<Record<string, string>>({ day: todayIST() < c.start_date ? c.start_date : shiftBack(todayIST()) });
  const [parsed, setParsed] = useState<ReturnType<typeof parseResultsCsv> | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const saveRows = async (rows: Record<string, unknown>[]) => {
    setBusy(true);
    try { const n = await mkApi.saveResults(c.id, rows); notify(`${n} day${n === 1 ? '' : 's'} saved.`, 'success'); await onSaved(); onClose(); }
    catch (e) { notify(errText(e, 'Could not save the results.'), 'error', 9000); } finally { setBusy(false); }
  };
  const onFile = async (file?: File) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { notify('That file is too big (5 MB max).', 'error'); return; }
    if (!/\.csv$/i.test(file.name)) { notify('Export the report as CSV from Ads Manager.', 'error'); return; }
    setParsed(parseResultsCsv(await file.text()));
  };
  const valid = (parsed?.rows ?? []).filter((r) => String(r.day) >= c.start_date && String(r.day) <= todayIST());
  return (
    <Modal title={`Results · ${c.name}`} onClose={onClose} closeDisabled={busy} wide>
      <div className="space-y-4">
        <PillTabs size="sm" value={tab} onChange={setTab} items={[{ id: 'manual', label: 'Type in a day' }, { id: 'upload', label: 'Upload Ads Manager export' }]} />
        {tab === 'manual' ? (
          <>
            <Field label="Day"><input className="input !w-48" type="date" min={c.start_date} max={todayIST()} value={row.day} onChange={(e) => setRow((r) => ({ ...r, day: e.target.value }))} /></Field>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {RESULT_FIELDS.map((x) => <Field key={x.k} label={x.label}><input className="input text-right" type="number" min="0" step="any" value={row[x.k] ?? ''} onChange={(e) => setRow((r) => ({ ...r, [x.k]: e.target.value }))} /></Field>)}
            </div>
            <p className="text-[12px] text-ink-500">Saving a day that already has numbers replaces them.</p>
            <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button loading={busy} disabled={!row.day} onClick={() => void saveRows([row])}>Save day</Button></div>
          </>
        ) : (
          <>
            <Notice tone="sky">In Meta Ads Manager or Google Ads, open this campaign, set <b>Breakdown → By time → Day</b>, then <b>Export → CSV</b>. Days already saved are replaced.</Notice>
            <input ref={input} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
            <button type="button" className="btn-secondary" onClick={() => input.current?.click()}><Upload className="w-4 h-4" />Choose CSV file</button>
            {parsed?.error && <Notice tone="rose">{parsed.error}</Notice>}
            {parsed && !parsed.error && (
              <>
                <p className="text-[12.5px] text-ink-600">Found <b>{parsed.rows.length}</b> days · columns read: {parsed.matched.join(', ')}{valid.length < parsed.rows.length ? ` · ${parsed.rows.length - valid.length} outside the campaign dates will be skipped` : ''}</p>
                <div className="max-h-64 overflow-auto rounded-2xl border border-ink-100">
                  <table className="data-table"><thead><tr><th>Day</th>{RESULT_FIELDS.map((x) => <th key={x.k} className="text-right">{x.label}</th>)}</tr></thead>
                    <tbody>{valid.slice(0, 60).map((r) => <tr key={String(r.day)}><td>{fmtDay(String(r.day), true)}</td>{RESULT_FIELDS.map((x) => <td key={x.k} className="text-right tnum">{num(Number(r[x.k] ?? 0))}</td>)}</tr>)}</tbody></table>
                </div>
                <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
                  <Button loading={busy} disabled={!valid.length || valid.length > 400} icon={<FileSpreadsheet className="w-4 h-4" />} onClick={() => void saveRows(valid)}>Save {valid.length} days</Button></div>
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
const shiftBack = (d: string) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() - 1); return t.toISOString().slice(0, 10); };

/* ====================================================================== REPORTS */

export function ReportsSection({ clientId, data, mode, reload }: { clientId: string; data: MkData; mode: Mode; reload: () => Promise<void> }) {
  const { files, reload: reloadFiles } = useFiles('mk_report', data.reports.map((r) => r.id));
  const [adding, setAdding] = useState(false);
  const team = mode !== 'client';
  return (
    <div className="space-y-4">
      {team && <div className="flex justify-end"><Button size="sm" icon={<Upload className="w-4 h-4" />} onClick={() => setAdding(true)}>Upload report</Button></div>}
      {data.reports.length ? (
        <Card className="overflow-hidden"><ul className="divide-y divide-ink-100">
          {data.reports.map((r) => {
            const rf = files.filter((f) => f.parent_id === r.id);
            return (
              <li key={r.id} className="px-5 py-3.5 flex flex-wrap items-center gap-3">
                <span className="w-9 h-9 rounded-xl bg-brand-50 text-brand-700 grid place-items-center shrink-0"><FileText className="w-4 h-4" /></span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-[14px] text-ink-900">{r.title}</p>
                  <p className="text-[12px] text-ink-500">{r.period_start ? `${fmtDay(r.period_start)} – ${fmtDay(r.period_end, true)} · ` : ''}uploaded {fmtDay(r.created_at.slice(0, 10), true)}{team && !r.visible_to_client ? ' · hidden from client' : ''}</p>
                </div>
                {rf.map((f) => <button key={f.id} type="button" className="btn-secondary btn-sm" onClick={() => openFile(f).catch((e: unknown) => notify(errText(e, 'File not available.'), 'error'))}>Download</button>)}
                {team && <button type="button" className="icon-btn text-ink-500" title="Remove report" onClick={() => void mkApi.saveReport(r.id, null, { archive: true }).then(reload).then(() => notify('Report removed.', 'success')).catch((e: unknown) => notify(errText(e, 'Could not remove.'), 'error'))}><Trash2 className="w-4 h-4" /></button>}
              </li>
            );
          })}
        </ul></Card>
      ) : <Card><EmptyState icon={<FileText className="w-6 h-6" />} title="No reports yet" text={team ? 'Upload monthly or campaign reports (PDF, Excel, PowerPoint).' : 'Reports from your team will show here.'} className="!py-10" /></Card>}
      {adding && <ReportDialog clientId={clientId} onClose={() => setAdding(false)} onSaved={async () => { await reload(); await reloadFiles(); }} />}
    </div>
  );
}

function ReportDialog({ clientId, onClose, onSaved }: { clientId: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const month = todayIST().slice(0, 7);
  const [title, setTitle] = useState(`Marketing report – ${new Date(`${month}-01T00:00:00+05:30`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}`);
  const [from, setFrom] = useState(`${month}-01`); const [to, setTo] = useState(todayIST());
  const [visible, setVisible] = useState(true); const [file, setFile] = useState<File | null>(null); const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const go = async () => {
    if (!file) return;
    setBusy(true);
    let id: string | null = null;
    try {
      id = await mkApi.saveReport(null, clientId, { title, period_start: from, period_end: to, visible_to_client: visible });
      await uploadAndAttach(file, 'mk_report', id, { visibility: 'client' });
      await mkApi.publishReport(id);
      notify(visible ? 'Report uploaded. The client has been told.' : 'Report uploaded.', 'success');
      await onSaved(); onClose();
    } catch (e) {
      if (id) await mkApi.saveReport(id, null, { archive: true }).catch(() => undefined);
      notify(errText(e, 'Could not upload the report.'), 'error', 8000);
    } finally { setBusy(false); }
  };
  return (
    <Modal title="Upload report" onClose={onClose} closeDisabled={busy}>
      <div className="space-y-4">
        <Field label="Title"><input className="input" value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From"><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><input className="input" type="date" min={from} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
        <input ref={input} type="file" accept=".pdf,.xls,.xlsx,.csv,.ppt,.pptx,.doc,.docx,.png,.jpg,.jpeg" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <button type="button" className="btn-secondary w-full justify-center" onClick={() => input.current?.click()}><Upload className="w-4 h-4" />{file ? file.name : 'Choose file'}</button>
        <label className="flex items-center gap-2 text-[13px] text-ink-700"><input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} />Client can see this report</label>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button loading={busy} disabled={!file || !title.trim()} onClick={() => void go()}>Upload</Button></div>
      </div>
    </Modal>
  );
}

/* ====================================================================== AD MONEY */

const MONEY_LABEL: Record<MkMoney['kind'], string> = { request: 'Requested from client', receipt: 'Payment received', refund: 'Refunded to client', adjustment: 'Adjustment' };

export function MoneySection({ clientId, data, mode, reload, people }: { clientId: string; data: MkData; mode: Mode; reload: () => Promise<void>; people?: People }) {
  const s = moneySummary(data.money, data.results);
  const [adding, setAdding] = useState<MkMoney['kind'] | null>(null);
  const [voiding, setVoiding] = useState<MkMoney | null>(null);
  const admin = mode === 'admin';
  const openReq = new Map(s.requests.map((r) => [r.id, r]));
  const [paying, setPaying] = useState<{ requestId: string | null; amount?: number } | null>(null);
  const [rejecting, setRejecting] = useState<MkClaim | null>(null);
  const [busyClaim, setBusyClaim] = useState<string | null>(null);
  const pending = data.claims.filter((c) => c.status === 'pending');
  const confirm = async (c: MkClaim) => {
    setBusyClaim(c.id);
    try { await mkApi.decideClaim(c.id, 'confirm', ''); notify('Payment confirmed. Added to the ad money and the client has been told.', 'success'); await reload(); }
    catch (e) { notify(errText(e, 'Could not confirm.'), 'error', 8000); } finally { setBusyClaim(null); }
  };
  return (
    <div className="space-y-4">
      {pending.length > 0 && mode !== 'client' && (
        <Card className="p-4 space-y-2 border-amber-200">
          <h3 className="font-display font-bold text-[15px] text-ink-900">Client says paid — {admin ? 'check your bank and confirm' : 'waiting for admin to confirm'}</h3>
          {pending.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-amber-50 border border-amber-100 px-4 py-3">
              <div className="min-w-0 flex-1 text-[13px] text-amber-950">
                <b className="tnum">{inr(c.amount)}</b> paid {fmtDay(c.paid_on, true)} by {c.method.replace('_', ' ')}{c.reference ? <> · UTR <b className="font-mono">{c.reference}</b></> : ''}
                {c.note && <span className="text-amber-800"> · {c.note}</span>}
              </div>
              {admin && <>
                <button type="button" className="btn-ghost btn-sm text-rose-700" onClick={() => setRejecting(c)}>Not received</button>
                <Button size="sm" disabled={busyClaim === c.id} icon={<CheckCircle2 className="w-4 h-4" />} onClick={() => void confirm(c)}>Confirm received</Button>
              </>}
            </div>
          ))}
        </Card>
      )}
      {mode === 'client' && (
        <Card className="p-4 sm:p-5 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <h3 className="font-display font-bold text-[16px] text-ink-900">Paid your ad budget?</h3>
              <p className="text-[12.5px] text-ink-500">Tell us the amount and UTR. It shows as received once our team confirms it in the bank.</p>
            </div>
            {!s.requests.some((r) => r.open > 0) && <Button icon={<Send className="w-4 h-4" />} onClick={() => setPaying({ requestId: null })}>I’ve paid</Button>}
          </div>
          {s.requests.filter((r) => r.open > 0).map((r) => {
            const waiting = pending.filter((c) => c.request_id === r.id).reduce((a, c) => a + Number(c.amount), 0);
            return (
              <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-amber-50 border border-amber-100 px-4 py-3 text-[13px]">
                <span className="flex-1 text-amber-950">Requested {fmtDay(r.entry_date)}{r.due_date ? ` · due ${fmtDay(r.due_date)}` : ''} — <b className="tnum">{inr(r.open)}</b> to pay{waiting ? ` · ${inr(waiting)} waiting for confirmation` : ''}</span>
                <Button size="sm" icon={<Send className="w-3.5 h-3.5" />} onClick={() => setPaying({ requestId: r.id, amount: Math.max(0, r.open - waiting) || r.open })}>I’ve paid this</Button>
              </div>
            );
          })}
          {s.requests.some((r) => r.open > 0) && (
            <button type="button" className="text-[12.5px] font-semibold text-brand-700 hover:underline" onClick={() => setPaying({ requestId: null })}>Paid a different amount? Tell us here</button>
          )}
          {data.claims.length > 0 && (
            <ul className="divide-y divide-ink-100">
              {data.claims.slice(0, 10).map((c) => (
                <li key={c.id} className="py-2 flex flex-wrap items-center gap-2 text-[13px]">
                  <span className="text-ink-500 w-24">{fmtDay(c.paid_on, true)}</span>
                  <span className="flex-1 text-ink-800">{c.method.replace('_', ' ')}{c.reference ? ` · ${c.reference}` : ''}{c.status === 'rejected' && c.reject_reason ? ` — ${c.reject_reason}` : ''}</span>
                  <span className="tnum font-semibold">{inr(c.amount)}</span>
                  <Badge tone={c.status === 'confirmed' ? 'mint' : c.status === 'rejected' ? 'rose' : 'amber'} dot>{c.status === 'confirmed' ? 'Confirmed' : c.status === 'rejected' ? 'Not confirmed' : 'Waiting for confirmation'}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Big label="Ad money received" value={s.received} />
        <Big label="Spent on ads" value={s.spent} />
        <Big label="Balance left" value={s.balance} tone={s.balance < 0 ? 'rose' : 'ink'} />
        <Big label={mode === 'client' ? 'To pay' : 'Pending from client'} value={s.pending} tone={s.pending > 0 ? 'amber' : 'ink'} />
      </div>
      {admin && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" icon={<Plus className="w-4 h-4" />} onClick={() => setAdding('receipt')}>Record payment</Button>
          <Button size="sm" variant="secondary" onClick={() => setAdding('request')}>Request ad money</Button>
          <button type="button" className="btn-ghost btn-sm" onClick={() => setAdding('refund')}>Refund</button>
          <button type="button" className="btn-ghost btn-sm" onClick={() => setAdding('adjustment')}>Adjust</button>
        </div>
      )}
      <Card className="overflow-hidden">
        {data.money.length ? (
          <div className="overflow-x-auto"><table className="data-table">
            <thead><tr><th>Date</th><th>Entry</th><th>Details</th><th className="text-right">Amount</th>{admin && <th />}</tr></thead>
            <tbody>{data.money.map((m) => {
              const req = m.kind === 'request' ? openReq.get(m.id) : null;
              return (
                <tr key={m.id} className={cx(m.voided_at && 'opacity-50 line-through')}>
                  <td className="whitespace-nowrap">{fmtDay(m.entry_date, true)}</td>
                  <td className="whitespace-nowrap"><span className="font-semibold text-ink-900">{MONEY_LABEL[m.kind]}</span>
                    {req && <div className="mt-0.5">{req.open > 0 ? <Badge tone="amber">{inr(req.open)} open</Badge> : <Badge tone="mint">Paid</Badge>}</div>}</td>
                  <td className="text-[12.5px] text-ink-600 max-w-[320px]">{[m.method?.replace('_', ' '), m.reference, m.due_date && `due ${fmtDay(m.due_date)}`, m.note, m.voided_at && `voided: ${m.void_reason}`].filter(Boolean).join(' · ') || '—'}</td>
                  <td className={cx('text-right tnum font-semibold', m.kind === 'receipt' ? 'text-emerald-700' : m.kind === 'refund' ? 'text-rose-700' : 'text-ink-900')}>{m.kind === 'refund' ? '−' : m.kind === 'receipt' ? '+' : ''}{inr(Math.abs(m.amount))}</td>
                  {admin && <td>{!m.voided_at && <button type="button" className="btn-ghost btn-sm text-rose-700" onClick={() => setVoiding(m)}>Void</button>}</td>}
                </tr>
              );
            })}</tbody>
          </table></div>
        ) : <p className="px-5 py-8 text-center text-[13px] text-ink-400">No ad money recorded yet.</p>}
      </Card>
      <p className="text-[12px] text-ink-500">Spent is the total of the daily ad results. Your management fee is billed separately on invoices.</p>
      {mode !== 'client' && people && <TeamBudget clientId={clientId} data={data} admin={admin} people={people} received={s.received} reload={reload} />}
      {adding && <MoneyDialog clientId={clientId} kind={adding} openRequests={s.requests.filter((r) => r.open > 0)} onClose={() => setAdding(null)} onSaved={reload} />}
      {voiding && <VoidDialog m={voiding} onClose={() => setVoiding(null)} onSaved={reload} />}
      {paying && <ClaimDialog requestId={paying.requestId} initial={paying.amount} requests={s.requests.filter((r) => r.open > 0)} onClose={() => setPaying(null)} onSaved={reload} />}
      {rejecting && <ReasonDialog title={`Not received: ${inr(rejecting.amount)}?`} required onClose={() => setRejecting(null)}
        onSave={async (r) => { await mkApi.decideClaim(rejecting.id, 'reject', r); notify('The client has been told.', 'success'); await reload(); }} />}
    </div>
  );
}
const Big = ({ label, value, tone = 'ink' }: { label: string; value: number; tone?: 'ink' | 'amber' | 'rose' }) => (
  <Card className="p-4"><p className="text-[12px] text-ink-500 font-semibold">{label}</p><p className={cx('mt-1 font-display text-[24px] font-bold tnum', tone === 'rose' ? 'text-rose-700' : tone === 'amber' ? 'text-amber-700' : 'text-ink-950')}>{inr(value)}</p></Card>
);

function MoneyDialog({ clientId, kind, openRequests, onClose, onSaved }: { clientId: string; kind: MkMoney['kind']; openRequests: { id: string; open: number; entry_date: string }[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const [f, setF] = useState({ amount: '', entry_date: todayIST(), due_date: '', method: 'bank_transfer', reference: '', note: '', request_id: openRequests[0]?.id ?? '' });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const go = async () => {
    setBusy(true);
    try {
      await mkApi.addMoney(clientId, { kind, ...f, request_id: kind === 'receipt' ? f.request_id || null : null });
      notify('Saved.', 'success'); await onSaved(); onClose();
    } catch (e) { notify(errText(e, 'Could not save.'), 'error', 8000); } finally { setBusy(false); }
  };
  return (
    <Modal title={MONEY_LABEL[kind]} onClose={onClose} closeDisabled={busy}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label={kind === 'adjustment' ? 'Amount ₹ (use − to reduce)' : 'Amount ₹'}><input className="input text-right" type="number" step="0.01" value={f.amount} onChange={(e) => set('amount', e.target.value)} /></Field>
          <Field label="Date"><input className="input" type="date" max={todayIST()} value={f.entry_date} onChange={(e) => set('entry_date', e.target.value)} /></Field>
          {kind === 'request' && <Field label="Due by" hint="optional"><input className="input" type="date" min={todayIST()} value={f.due_date} onChange={(e) => set('due_date', e.target.value)} /></Field>}
          {(kind === 'receipt' || kind === 'refund') && <>
            <Field label="Method"><select className="input" value={f.method} onChange={(e) => set('method', e.target.value)}>{['bank_transfer', 'upi', 'cash', 'cheque', 'card', 'other'].map((m) => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}</select></Field>
            <Field label="Reference / UTR" hint="optional"><input className="input" value={f.reference} maxLength={120} onChange={(e) => set('reference', e.target.value)} /></Field>
          </>}
          {kind === 'receipt' && openRequests.length > 0 && <Field label="Against request"><select className="input" value={f.request_id} onChange={(e) => set('request_id', e.target.value)}>
            <option value="">Not linked</option>{openRequests.map((r) => <option key={r.id} value={r.id}>{fmtDay(r.entry_date)} · {inr(r.open)} open</option>)}</select></Field>}
        </div>
        <Field label="Note" hint={kind === 'adjustment' ? 'required' : 'optional'}><input className="input" value={f.note} maxLength={600} onChange={(e) => set('note', e.target.value)} /></Field>
        {kind === 'request' && <p className="text-[12px] text-ink-500">The client is notified if they have portal access.</p>}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button loading={busy} disabled={!f.amount || Number(f.amount) === 0} onClick={() => void go()}>Save</Button></div>
      </div>
    </Modal>
  );
}

function VoidDialog({ m, onClose, onSaved }: { m: MkMoney; onClose: () => void; onSaved: () => Promise<void> }) {
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try { await mkApi.voidMoney(m.id, reason.trim()); notify('Entry voided.', 'success'); await onSaved(); onClose(); }
    catch (e) { notify(errText(e, 'Could not void.'), 'error', 8000); } finally { setBusy(false); }
  };
  return (
    <Modal title="Void this entry?" onClose={onClose} closeDisabled={busy}>
      <div className="space-y-4">
        <p className="text-[13.5px] text-ink-700">{MONEY_LABEL[m.kind]} of {inr(m.amount)} on {fmtDay(m.entry_date, true)}. It stays in the history, crossed out.</p>
        <Field label="Reason"><input className="input" value={reason} maxLength={400} onChange={(e) => setReason(e.target.value)} /></Field>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose} disabled={busy}>Back</Button><Button loading={busy} disabled={reason.trim().length < 3} className="!bg-rose-600" onClick={() => void go()}>Void</Button></div>
      </div>
    </Modal>
  );
}


/* ====================================================================== TEAM BUDGET (internal: admin → performance marketer) */

function TeamBudget({ clientId, data, admin, people, received, reload }: { clientId: string; data: MkData; admin: boolean; people: People; received: number; reload: () => Promise<void> }) {
  const rows = budgetByPerson(data.budget, data.campaigns, data.results);
  const withTeam = rows.reduce((a, r) => a + r.given, 0);
  const free = received - withTeam;
  const mine = rows.find((r) => r.employeeId === people.me);
  const [give, setGive] = useState<{ employeeId: string; amount?: number; requestId?: string } | null>(null);
  const [ret, setRet] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [decline, setDecline] = useState<MkBudget | null>(null);
  const [voiding, setVoiding] = useState<MkBudget | null>(null);
  const openRequests = data.budget.filter((b) => b.kind === 'request' && b.status === 'open' && !b.voided_at);
  const history = data.budget.filter((b) => b.kind !== 'request' || b.status !== 'open');
  const isMarketer = !!people.me && people.marketers.some((m) => m.id === people.me);

  return (
    <Card className="p-5 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-display font-bold text-[16px] text-ink-900 mr-auto">{admin ? 'Budget with the marketing team' : 'My ad budget'}</h3>
        <Badge tone="ink">Internal · client doesn’t see this</Badge>
      </div>
      {admin ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <MiniMoney label="Received from client" value={received} />
            <MiniMoney label="Given to team" value={withTeam} />
            <MiniMoney label="Still with you" value={free} tone={free < 0 ? 'rose' : 'ink'} />
          </div>
          {openRequests.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-amber-50 border border-amber-100 px-4 py-3">
              <div className="min-w-0 flex-1 text-[13px] text-amber-900"><b>{people.nameOf(r.employee_id)}</b> asks for <b>{inr(r.amount)}</b>{r.note ? ` — ${r.note}` : ''}<span className="text-amber-700"> · {fmtDay(r.entry_date)}</span></div>
              <button type="button" className="btn-ghost btn-sm text-rose-700" onClick={() => setDecline(r)}>Decline</button>
              <Button size="sm" disabled={free <= 0} title={free <= 0 ? 'Record the client’s payment first' : undefined} onClick={() => setGive({ employeeId: r.employee_id, amount: Math.min(Number(r.amount), free), requestId: r.id })}>Give {inr(Math.min(Number(r.amount), Math.max(free, 0)))}</Button>
            </div>
          ))}
          <div className="rounded-2xl border border-ink-100 overflow-x-auto">
            <table className="data-table">
              <thead><tr><th>Marketer</th><th className="text-right">Given</th><th className="text-right">Spent on ads</th><th className="text-right">Left with them</th><th /></tr></thead>
              <tbody>
                {people.marketers.map((m) => {
                  const r = rows.find((x) => x.employeeId === m.id) ?? { given: 0, spent: 0, left: 0 };
                  return (
                    <tr key={m.id}>
                      <td className="font-semibold text-ink-900">{m.name}</td>
                      <td className="text-right tnum">{inr(r.given)}</td>
                      <td className="text-right tnum">{inr(r.spent)}</td>
                      <td className={cx('text-right tnum font-semibold', r.left < 0 ? 'text-rose-700' : r.left < (data.settings?.low_balance ?? 0) ? 'text-amber-700' : 'text-ink-900')}>{inr(r.left)}</td>
                      <td className="whitespace-nowrap text-right">
                        <Button size="sm" disabled={free <= 0} title={free <= 0 ? 'Record the client’s payment first' : undefined} onClick={() => setGive({ employeeId: m.id })}>Give budget</Button>
                        {r.given > 0 && <button type="button" className="btn-ghost btn-sm ml-1" onClick={() => setRet(m.id)}>Returned</button>}
                      </td>
                    </tr>
                  );
                })}
                {!people.marketers.length && <tr><td colSpan={5} className="text-[13px] text-ink-500">No one has the Performance Marketing designation yet. Set it in Employees.</td></tr>}
              </tbody>
            </table>
          </div>
          {free <= 0 && <p className="text-[12px] text-ink-500">You can only give budget from what the client has paid. Record the client’s payment above first.</p>}
        </>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <MiniMoney label="Given to me" value={mine?.given ?? 0} />
            <MiniMoney label="Spent on my campaigns" value={mine?.spent ?? 0} />
            <MiniMoney label="Left with me" value={mine?.left ?? 0} tone={(mine?.left ?? 0) < 0 ? 'rose' : (mine?.left ?? 0) < (data.settings?.low_balance ?? 0) ? 'amber' : 'ink'} />
          </div>
          {mine?.open.map((r) => <p key={r.id} className="text-[12.5px] text-amber-800 rounded-xl bg-amber-50 px-3 py-2">Waiting for admin: {inr(r.amount)} requested {fmtDay(r.entry_date)}</p>)}
          {isMarketer && <div className="flex justify-end"><Button size="sm" icon={<Plus className="w-4 h-4" />} onClick={() => setAsking(true)}>Ask admin for more budget</Button></div>}
        </>
      )}
      {history.length > 0 && (
        <details className="text-[13px]">
          <summary className="cursor-pointer font-semibold text-ink-600">History ({history.length})</summary>
          <ul className="mt-2 divide-y divide-ink-100">
            {history.map((b) => (
              <li key={b.id} className={cx('py-2 flex flex-wrap items-center gap-2', b.voided_at && 'opacity-50 line-through')}>
                <span className="text-ink-500 w-24">{fmtDay(b.entry_date, true)}</span>
                <span className="flex-1 text-ink-800">{b.kind === 'given' ? `Given to ${people.nameOf(b.employee_id)}` : b.kind === 'returned' ? `Returned by ${people.nameOf(b.employee_id)}` : `${people.nameOf(b.employee_id)} asked (${b.status})`}{b.note ? ` · ${b.note}` : ''}{b.voided_at ? ` · voided: ${b.void_reason}` : ''}</span>
                <span className="tnum font-semibold">{inr(b.amount)}</span>
                {admin && !b.voided_at && b.kind !== 'request' && <button type="button" className="btn-ghost btn-sm text-rose-700" onClick={() => setVoiding(b)}>Void</button>}
              </li>
            ))}
          </ul>
        </details>
      )}
      {give && <AmountDialog title={`Give budget to ${people.nameOf(give.employeeId)}`} max={free} initial={give.amount} hint={`Up to ${inr(free)} — what the client has paid that is still with you.`}
        onClose={() => setGive(null)} onSave={async (amt, note) => { await mkApi.giveBudget(clientId, give.employeeId, amt, note, give.requestId ?? null); notify('Budget given. They have been notified.', 'success'); await reload(); }} />}
      {ret && <AmountDialog title={`Money returned by ${people.nameOf(ret)}`} max={rows.find((x) => x.employeeId === ret)?.given ?? 0} hint="Unused budget handed back to you."
        onClose={() => setRet(null)} onSave={async (amt, note) => { await mkApi.returnBudget(clientId, ret, amt, note); notify('Saved.', 'success'); await reload(); }} />}
      {asking && <AmountDialog title="Ask admin for more budget" hint="The admin gets a notification." noteRequired
        onClose={() => setAsking(false)} onSave={async (amt, note) => { await mkApi.requestBudget(clientId, amt, note); notify('Request sent to the admin.', 'success'); await reload(); }} />}
      {decline && <ReasonDialog title="Decline this request?" onClose={() => setDecline(null)} onSave={async (r) => { await mkApi.decideBudget(decline.id, 'decline', r); notify('Declined.', 'success'); await reload(); }} />}
      {voiding && <ReasonDialog title="Void this entry?" required onClose={() => setVoiding(null)} onSave={async (r) => { await mkApi.decideBudget(voiding.id, 'void', r); notify('Voided.', 'success'); await reload(); }} />}
    </Card>
  );
}
const MiniMoney = ({ label, value, tone = 'ink' }: { label: string; value: number; tone?: 'ink' | 'amber' | 'rose' }) => (
  <div className="rounded-2xl bg-ink-50/70 px-3 py-2.5"><p className="text-[11.5px] text-ink-500 font-semibold">{label}</p>
    <p className={cx('font-display text-[20px] font-bold tnum', tone === 'rose' ? 'text-rose-700' : tone === 'amber' ? 'text-amber-700' : 'text-ink-950')}>{inr(value)}</p></div>
);

function AmountDialog({ title, hint, max, initial, noteRequired, onClose, onSave }: {
  title: string; hint?: string; max?: number; initial?: number; noteRequired?: boolean; onClose: () => void; onSave: (amount: number, note: string) => Promise<void>;
}) {
  const [amount, setAmount] = useState(initial ? String(initial) : ''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  const n = Number(amount);
  const bad = !n || n <= 0 || (max != null && n > max + 0.001) || (noteRequired && note.trim().length < 3);
  const go = async () => { setBusy(true); try { await onSave(n, note.trim()); onClose(); } catch (e) { notify(errText(e, 'That didn’t work.'), 'error', 9000); } finally { setBusy(false); } };
  return (
    <Modal title={title} onClose={onClose} closeDisabled={busy}>
      <div className="space-y-4">
        <Field label="Amount ₹"><input className="input text-right" type="number" min="1" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></Field>
        {hint && <p className="text-[12px] text-ink-500">{hint}</p>}
        {max != null && n > max && <p className="text-[12px] text-rose-700">That is more than {inr(max)}.</p>}
        <Field label="Note" hint={noteRequired ? 'what it’s for' : 'optional'}><input className="input" value={note} maxLength={600} onChange={(e) => setNote(e.target.value)} /></Field>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button loading={busy} disabled={bad} onClick={() => void go()}>Save</Button></div>
      </div>
    </Modal>
  );
}
function ReasonDialog({ title, required, onClose, onSave }: { title: string; required?: boolean; onClose: () => void; onSave: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); try { await onSave(reason.trim()); onClose(); } catch (e) { notify(errText(e, 'That didn’t work.'), 'error', 8000); } finally { setBusy(false); } };
  return (
    <Modal title={title} onClose={onClose} closeDisabled={busy}>
      <div className="space-y-4">
        <Field label="Reason" hint={required ? undefined : 'optional'}><input className="input" value={reason} maxLength={400} onChange={(e) => setReason(e.target.value)} /></Field>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose} disabled={busy}>Back</Button><Button loading={busy} disabled={!!required && reason.trim().length < 3} className="!bg-rose-600" onClick={() => void go()}>Confirm</Button></div>
      </div>
    </Modal>
  );
}

function ClaimDialog({ requestId, initial, requests, onClose, onSaved }: {
  requestId: string | null; initial?: number; requests: { id: string; open: number; entry_date: string }[]; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const [f, setF] = useState({ request_id: requestId ?? '', amount: initial ? String(initial) : '', paid_on: todayIST(), method: 'upi', reference: '', note: '' });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const needRef = !['cash', 'other'].includes(f.method);
  const go = async () => {
    setBusy(true);
    try {
      await mkApi.submitClaim(f.request_id || null, Number(f.amount), f.paid_on, f.method, f.reference.trim(), f.note.trim());
      notify('Thanks! We’ll confirm it once it shows in our bank.', 'success'); await onSaved(); onClose();
    } catch (e) { notify(errText(e, 'Could not send.'), 'error', 9000); } finally { setBusy(false); }
  };
  return (
    <Modal title="I’ve paid the ad budget" onClose={onClose} closeDisabled={busy}>
      <div className="space-y-4">
        {requests.length > 0 && <Field label="For"><select className="input" value={f.request_id} onChange={(e) => set('request_id', e.target.value)}>
          <option value="">General ad budget</option>{requests.map((r) => <option key={r.id} value={r.id}>Request of {fmtDay(r.entry_date)} · {inr(r.open)} to pay</option>)}</select></Field>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount ₹"><input className="input text-right" type="number" min="1" step="0.01" value={f.amount} onChange={(e) => set('amount', e.target.value)} /></Field>
          <Field label="Paid on"><input className="input" type="date" max={todayIST()} value={f.paid_on} onChange={(e) => set('paid_on', e.target.value)} /></Field>
          <Field label="How"><select className="input" value={f.method} onChange={(e) => set('method', e.target.value)}>
            {[['upi', 'UPI'], ['bank_transfer', 'Bank transfer'], ['cheque', 'Cheque'], ['card', 'Card'], ['cash', 'Cash'], ['other', 'Other']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
          <Field label={needRef ? 'UTR / reference' : 'Reference'} hint={needRef ? undefined : 'optional'}><input className="input font-mono" value={f.reference} maxLength={120} onChange={(e) => set('reference', e.target.value)} /></Field>
        </div>
        <Field label="Note" hint="optional"><input className="input" value={f.note} maxLength={600} onChange={(e) => set('note', e.target.value)} /></Field>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button loading={busy} disabled={!Number(f.amount) || (needRef && !f.reference.trim())} onClick={() => void go()}>Send</Button></div>
      </div>
    </Modal>
  );
}
