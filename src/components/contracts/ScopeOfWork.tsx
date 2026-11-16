import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ListChecks, Lock, Plus, Save, Trash2 } from 'lucide-react';
import { Button, Card, CardHead, useToast } from '../client/ClientUI';
import { errorMessage, rpc, type ContractRow, type DeliverableRow, type ScopeRow } from '../../lib/sigma';

/**
 * Scope of work on a contract.
 *
 * Each row is a deliverable in Draft attached to the contract. The admin edits the table while the
 * contract is a draft (or was declined). Sending freezes a copy into the contract version: that copy
 * is what the client sees and signs, and signing turns every row into an active deliverable.
 */

const fmtQty = (r: ScopeRow) => (r.quantity == null ? '' : `${Number(r.quantity)}${r.unit ? ` ${r.unit}` : ''}`);

/** Read-only scope table: the client's contract view and the admin's view once sent. */
export function ScopeTable({ rows, caption }: { rows: ScopeRow[]; caption?: React.ReactNode }) {
  if (!rows.length) return <p className="text-[13px] text-ink-3">No scope of work on this version.</p>;
  return (
    <div>
      {caption && <p className="text-xs text-ink-3 mb-2">{caption}</p>}
      {/* phones: one card per row */}
      <ol className="sm:hidden space-y-2.5">
        {rows.map((r, i) => (
          <li key={i} className="rounded-2xl border border-ink-100 p-3.5">
            <p className="text-[11px] font-bold text-ink-3">{i + 1}{r.no ? ` · ${r.no}` : ''}</p>
            <p className="font-bold text-[14px] text-ink-900 mt-0.5">{r.task}</p>
            {r.scope && <p className="text-[13px] text-ink-2 mt-1 whitespace-pre-line">{r.scope}</p>}
            {r.handover?.length > 0 && <p className="text-[12.5px] mt-2"><span className="font-semibold text-ink-700">You receive: </span>{r.handover.join(', ')}</p>}
            <p className="text-[12px] text-ink-3 mt-1.5">{[fmtQty(r) && `Qty ${fmtQty(r)}`, r.timeline, r.drafts != null && `${r.drafts} drafts`].filter(Boolean).join(' · ')}</p>
          </li>
        ))}
      </ol>
      {/* wider screens: the table, as agreed */}
      <div className="hidden sm:block overflow-x-auto rounded-2xl border border-ink-100">
        <table className="w-full text-[13px]">
          <thead className="bg-ink-50 text-left">
            <tr>
              <th className="px-3 py-2.5 font-semibold w-12">Sl.No</th>
              <th className="px-3 py-2.5 font-semibold">Task</th>
              <th className="px-3 py-2.5 font-semibold">Scope</th>
              <th className="px-3 py-2.5 font-semibold">Deliverables</th>
              <th className="px-3 py-2.5 font-semibold whitespace-nowrap">Qty · Timeline · Drafts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-ink-100 align-top">
                <td className="px-3 py-3 tabular-nums">{i + 1}</td>
                <td className="px-3 py-3 font-semibold text-ink-900">{r.task}</td>
                <td className="px-3 py-3 whitespace-pre-line text-ink-2">{r.scope || '—'}</td>
                <td className="px-3 py-3">{r.handover?.length ? <ul className="space-y-0.5">{r.handover.map((h, j) => <li key={j}>• {h}</li>)}</ul> : '—'}</td>
                <td className="px-3 py-3 text-ink-2 whitespace-nowrap">{[fmtQty(r), r.timeline, r.drafts != null ? `${r.drafts} drafts` : null].filter(Boolean).join(' · ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface EditRow { id?: string; task: string; scope: string; handover: string; quantity: string; unit: string; timeline: string; drafts: string }
const blank = (): EditRow => ({ task: '', scope: '', handover: '', quantity: '1', unit: '', timeline: '', drafts: '3' });
const toEdit = (d: DeliverableRow): EditRow => ({
  id: d.id, task: d.name, scope: d.description ?? '', handover: (d.handover ?? []).join('\n'),
  quantity: String(d.quantity ?? 1), unit: d.unit ?? '', timeline: d.timeline ?? '', drafts: String(d.included_drafts ?? 3),
});

/** Admin: the scope of work for this contract. Editable while the contract is a draft or was declined. */
export function ScopeOfWorkCard({ contract, deliverables, frozen, reload }: {
  contract: ContractRow;
  /** All of the project's deliverables (the Draft ones attached to this contract are the scope). */
  deliverables: DeliverableRow[];
  /** The copy frozen into the current version when it was sent, if any. */
  frozen: ScopeRow[] | null;
  reload: () => Promise<void>;
}) {
  const toast = useToast();
  const editable = contract.status === 'Draft' || contract.status === 'Declined';
  const drafts = useMemo(
    () => deliverables
      .filter((d) => d.status === 'Draft' && (!d.contract_id || d.contract_id === contract.id))
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.deliverable_number).localeCompare(String(b.deliverable_number))),
    [deliverables, contract.id],
  );
  const [rows, setRows] = useState<EditRow[]>(() => (drafts.length ? drafts.map(toEdit) : [blank()]));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!dirty) setRows(drafts.length ? drafts.map(toEdit) : [blank()]); }, [drafts, dirty]);

  const set = (i: number, patch: Partial<EditRow>) => { setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r))); setDirty(true); };
  const move = (i: number, by: number) => {
    setRows((rs) => { const n = [...rs]; const [x] = n.splice(i, 1); n.splice(Math.max(0, Math.min(n.length, i + by)), 0, x); return n; });
    setDirty(true);
  };
  const remove = (i: number) => { setRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : [blank()])); setDirty(true); };

  async function save() {
    const filled = rows.filter((r) => r.task.trim() || r.scope.trim() || r.handover.trim());
    const bad = filled.findIndex((r) => r.task.trim().length < 2);
    if (bad >= 0) { toast(`Row ${bad + 1}: give the task a name.`, 'err'); return; }
    setBusy(true);
    try {
      // Rows taken out of the table were never sent or signed: archive them with a clear reason.
      const keep = new Set(filled.map((r) => r.id).filter(Boolean));
      for (const d of drafts) {
        if (!keep.has(d.id)) await rpc('staff_archive_deliverable', { p_deliverable_id: d.id, p_reason: 'Removed from the scope of work before sending' });
      }
      await rpc('staff_scope_save', {
        p_contract_id: contract.id,
        p_rows: filled.map((r) => ({
          id: r.id ?? null, task: r.task.trim(), scope: r.scope.trim(),
          handover: r.handover.split(/\n|,/).map((x) => x.trim()).filter(Boolean),
          quantity: r.quantity === '' ? 1 : Number(r.quantity), unit: r.unit.trim(), timeline: r.timeline.trim(),
          drafts: r.drafts === '' ? 3 : Number(r.drafts),
        })),
      });
      toast('Scope of work saved.');
      setDirty(false);
      await reload();
    } catch (e) { toast(errorMessage(e), 'err'); } finally { setBusy(false); }
  }

  if (!editable) {
    return (
      <Card>
        <CardHead title="Scope of work" desc={contract.status === 'Accepted' ? 'Agreed and signed. Changes go through a change request.' : 'Locked while the client reviews the contract.'} />
        <div className="flex items-center gap-2 text-[12.5px] text-ink-3 mb-3"><Lock className="w-3.5 h-3.5" />{contract.status === 'Accepted' ? 'Signed version' : 'Sent version'} · {frozen?.length ?? 0} task{(frozen?.length ?? 0) === 1 ? '' : 's'}</div>
        <ScopeTable rows={frozen ?? []} />
      </Card>
    );
  }

  return (
    <Card>
      <CardHead
        title="Scope of work"
        desc="What the client sees and signs. Each row becomes a deliverable when the client accepts the contract."
      />
      <div className="space-y-3">
        {rows.map((r, i) => (
          <div key={r.id ?? `new-${i}`} className="rounded-2xl border border-ink-100 p-3.5">
            <div className="flex items-center justify-between gap-2 mb-2.5">
              <span className="text-[12px] font-bold text-ink-3">Row {i + 1}</span>
              <span className="flex items-center gap-1">
                <button type="button" className="icon-btn" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="w-4 h-4" /></button>
                <button type="button" className="icon-btn" aria-label="Move down" disabled={i === rows.length - 1} onClick={() => move(i, 1)}><ArrowDown className="w-4 h-4" /></button>
                <button type="button" className="icon-btn text-rose-700" aria-label={`Remove row ${i + 1}`} onClick={() => remove(i)}><Trash2 className="w-4 h-4" /></button>
              </span>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.4fr_1.2fr] gap-3">
              <label className="block"><span className="label">Task</span>
                <input className="input" maxLength={200} value={r.task} placeholder="e.g. Tech Pack Development" onChange={(e) => set(i, { task: e.target.value })} />
              </label>
              <label className="block"><span className="label">Scope</span>
                <textarea className="input min-h-[84px]" maxLength={5000} value={r.scope} placeholder={'Fabric specifications\nFabric compositions\nFabric GSM'} onChange={(e) => set(i, { scope: e.target.value })} />
              </label>
              <label className="block"><span className="label">Deliverables (one per line)</span>
                <textarea className="input min-h-[84px]" value={r.handover} placeholder={'T Shirt Samples\nFabric Piece Swatch'} onChange={(e) => set(i, { handover: e.target.value })} />
              </label>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
              <label className="block"><span className="label">Quantity</span><input className="input" type="number" min={0} value={r.quantity} onChange={(e) => set(i, { quantity: e.target.value })} /></label>
              <label className="block"><span className="label">Unit</span><input className="input" maxLength={40} value={r.unit} placeholder="pieces" onChange={(e) => set(i, { unit: e.target.value })} /></label>
              <label className="block"><span className="label">Timeline</span><input className="input" maxLength={80} value={r.timeline} placeholder="10 working days" onChange={(e) => set(i, { timeline: e.target.value })} /></label>
              <label className="block"><span className="label">Drafts included</span><input className="input" type="number" min={0} max={20} value={r.drafts} onChange={(e) => set(i, { drafts: e.target.value })} /></label>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <Button icon={Plus} onClick={() => { setRows((rs) => [...rs, blank()]); setDirty(true); }}>Add row</Button>
        <div className="flex items-center gap-3">
          {dirty && <span className="text-[12.5px] text-amber-800 font-semibold">Unsaved changes</span>}
          <Button variant="primary" icon={Save} loading={busy} onClick={() => void save()}>Save scope</Button>
        </div>
      </div>
      <p className="text-xs text-ink-3 mt-3 flex items-center gap-1.5"><ListChecks className="w-3.5 h-3.5" />The contract can't be sent until the scope has at least one task.</p>
    </Card>
  );
}
