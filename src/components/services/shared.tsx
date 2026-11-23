import React, { useRef, useState } from 'react';
import { Download, Paperclip, Upload } from 'lucide-react';
import { Badge, cx } from '../../ui';
import { notify } from '../../lib/toast';
import { ACCEPT_ATTR, openFile, uploadAndAttach } from '../../lib/sigma';
import { REQUEST_STATUS, errText, fmtDate, fmtWhen, inr, type Activity, type Quote, type ServiceFile } from '../../lib/services';

const QUOTE_TONE: Record<Quote['status'], 'ink' | 'brand' | 'mint' | 'rose' | 'amber' | 'sky'> = {
  draft: 'ink', sent: 'brand', accepted: 'mint', rejected: 'rose', revision_requested: 'amber', superseded: 'ink',
};
const QUOTE_LABEL: Record<Quote['status'], string> = {
  draft: 'Draft', sent: 'Awaiting answer', accepted: 'Accepted', rejected: 'Declined', revision_requested: 'Changes asked', superseded: 'Replaced',
};

/** A quotation as the client reads it: lines, GST split, payment terms, validity. */
export function QuoteView({ quote, compact }: { quote: Quote; compact?: boolean }) {
  const items = quote.service_quote_items ?? [];
  const expired = quote.status === 'sent' && !!quote.valid_until && quote.valid_until < new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-display font-bold text-[16px] text-ink-900">Quotation v{quote.version_no}</span>
        <Badge tone={expired ? 'rose' : QUOTE_TONE[quote.status]} dot>{expired ? 'Expired' : QUOTE_LABEL[quote.status]}</Badge>
        {quote.valid_until && <span className="text-[12px] text-ink-500">Valid until {fmtDate(quote.valid_until)}</span>}
      </div>
      {!compact && quote.scope && <div><p className="label">Scope</p><p className="text-[13.5px] text-ink-700 whitespace-pre-line">{quote.scope}</p></div>}
      <div className="rounded-2xl border border-ink-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead><tr><th>Item</th><th className="text-right">Qty</th><th className="text-right">Rate</th><th className="text-right">Discount</th><th className="text-right">Amount</th></tr></thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <td className="min-w-[200px]">
                    <p className="font-semibold text-ink-900">{i.description}</p>
                    {i.details && <p className="text-[12px] text-ink-500 whitespace-pre-line">{i.details}</p>}
                    <p className="text-[11px] text-ink-400">SAC {i.sac} · GST {Number(i.gst_rate)}%{i.due_in_days != null ? ` · ready ${i.due_in_days} days after start` : ''}</p>
                  </td>
                  <td className="text-right tnum">{Number(i.qty)}</td>
                  <td className="text-right tnum">{inr(i.unit_price)}</td>
                  <td className="text-right tnum">{Number(i.discount) ? `− ${inr(i.discount)}` : '—'}</td>
                  <td className="text-right tnum font-semibold">{inr(i.taxable)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="p-3 border-t border-ink-100 flex justify-end">
          <div className="text-[13px] min-w-[240px] space-y-1">
            {Number(quote.discount_total) > 0 && <div className="flex justify-between"><span className="text-ink-500">Before discount</span><span className="tnum">{inr(quote.subtotal)}</span></div>}
            <div className="flex justify-between"><span className="text-ink-500">Taxable value</span><span className="tnum">{inr(quote.taxable_total)}</span></div>
            {quote.supply_type === 'intra' ? (
              <><div className="flex justify-between"><span className="text-ink-500">CGST</span><span className="tnum">{inr(quote.cgst_total)}</span></div>
                <div className="flex justify-between"><span className="text-ink-500">SGST</span><span className="tnum">{inr(quote.sgst_total)}</span></div></>
            ) : quote.supply_type === 'inter'
              ? <div className="flex justify-between"><span className="text-ink-500">IGST</span><span className="tnum">{inr(quote.igst_total)}</span></div>
              : <div className="flex justify-between"><span className="text-ink-500">GST</span><span className="tnum">{inr(quote.tax_total)}</span></div>}
            <div className="flex justify-between border-t border-ink-200 pt-1.5 text-[15px] font-bold"><span>Total</span><span className="tnum">{inr(quote.grand_total)}</span></div>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <p className="label">Payment terms</p>
          <ul className="text-[13px] text-ink-700 space-y-1">
            {quote.payment_terms.map((t, n) => (
              <li key={n} className="flex justify-between gap-3"><span>{n + 1}. {t.name} <span className="text-ink-400">({Number(t.percentage)}%)</span></span>
                <span className="tnum font-semibold">{inr(Math.round(Number(quote.grand_total) * Number(t.percentage)) / 100)}</span></li>
            ))}
          </ul>
          <p className="text-[11.5px] text-ink-500 mt-1">The first payment is requested when work is scheduled, due within {quote.first_term_due_days} day{quote.first_term_due_days === 1 ? '' : 's'}. Work starts once it’s paid.</p>
        </div>
        {(quote.timeline || quote.terms) && (
          <div className="space-y-3">
            {quote.timeline && <div><p className="label">Timeline</p><p className="text-[13px] text-ink-700 whitespace-pre-line">{quote.timeline}</p></div>}
            {!compact && quote.terms && <div><p className="label">Terms</p><p className="text-[12.5px] text-ink-600 whitespace-pre-line">{quote.terms}</p></div>}
          </div>
        )}
      </div>
      {quote.client_note && <p className="text-[12.5px] text-ink-600 rounded-xl bg-ink-50 px-3 py-2"><b>Client note:</b> {quote.client_note}</p>}
    </div>
  );
}

/** Files on a request. Clients can add files while the request is being quoted. */
export function RequestFiles({ requestId, files, canUpload, staff, onChanged }: {
  requestId: string; files: ServiceFile[]; canUpload: boolean; staff?: boolean; onChanged: () => Promise<void> | void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [shareWithClient, setShare] = useState(true);
  const upload = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true);
    try {
      for (const f of Array.from(list).slice(0, 10)) await uploadAndAttach(f, 'service_request', requestId, { visibility: staff && !shareWithClient ? 'internal' : 'client' });
      notify('File added.', 'success');
      await onChanged();
    } catch (e) { notify(errText(e, 'Could not add the file.'), 'error', 8000); }
    finally { setBusy(false); if (input.current) input.current.value = ''; }
  };
  return (
    <div className="space-y-2">
      {files.length ? (
        <ul className="space-y-1.5">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-2 text-[13px]">
              <Paperclip className="w-3.5 h-3.5 text-ink-400 shrink-0" />
              <button type="button" className="text-brand-700 hover:underline truncate text-left" onClick={() => openFile(f).catch((e) => notify(errText(e, 'File not available.'), 'error'))}>{f.name}</button>
              {staff && f.visibility === 'internal' && <Badge tone="ink">Internal</Badge>}
              <span className="text-[11px] text-ink-400 ml-auto shrink-0">{fmtDate(f.created_at)}</span>
              <Download className="w-3.5 h-3.5 text-ink-300 shrink-0" />
            </li>
          ))}
        </ul>
      ) : <p className="text-[12.5px] text-ink-500">No files yet.</p>}
      {canUpload && (
        <div className="flex flex-wrap items-center gap-3">
          <input ref={input} type="file" multiple accept={ACCEPT_ATTR} className="hidden" onChange={(e) => void upload(e.target.files)} />
          <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={() => input.current?.click()}><Upload className="w-4 h-4" />{busy ? 'Uploading…' : 'Add files'}</button>
          {staff && <label className="flex items-center gap-1.5 text-[12px] text-ink-600"><input type="checkbox" checked={shareWithClient} onChange={(e) => setShare(e.target.checked)} />Client can see</label>}
          <span className="text-[11px] text-ink-400">Up to 50 MB each</span>
        </div>
      )}
    </div>
  );
}

/** Timeline of status changes and notes. */
export function ActivityList({ items, staff, nameOf }: { items: Activity[]; staff?: boolean; nameOf?: (profileId: string | null) => string }) {
  if (!items.length) return <p className="text-[12.5px] text-ink-500">Nothing yet.</p>;
  return (
    <ol className="space-y-2.5">
      {items.map((a) => (
        <li key={a.id} className={cx('text-[12.5px] rounded-xl px-3 py-2', a.internal ? 'bg-amber-50 border border-amber-100' : 'bg-ink-50/70')}>
          <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-ink-400">
            <span>{fmtWhen(a.created_at)}</span>
            {staff && nameOf && a.actor && <span>· {nameOf(a.actor)}</span>}
            {a.internal && <span className="font-semibold text-amber-700">· Internal</span>}
          </div>
          <p className="text-ink-800 mt-0.5">
            {a.kind === 'status' && a.to_status
              ? <><b>{staff ? REQUEST_STATUS[a.to_status as keyof typeof REQUEST_STATUS]?.label ?? a.to_status : REQUEST_STATUS[a.to_status as keyof typeof REQUEST_STATUS]?.client ?? a.to_status}</b>{a.note ? ` — ${a.note}` : ''}</>
              : a.note}
          </p>
        </li>
      ))}
    </ol>
  );
}
