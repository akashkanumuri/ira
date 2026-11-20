/**
 * Printable accounting documents: tax invoice, receipt, credit / debit note.
 * Opens a print-ready page; the browser's "Save as PDF" produces the PDF.
 * Data is read with the signed-in user's own access (RLS), so a client only ever gets their own documents.
 * Every value is HTML-escaped before it is written into the page.
 */
import { supabase } from '../../lib/supabase';

const db = () => supabase as any;

export const GST_STATES: { code: string; name: string }[] = [
  { code: '01', name: 'Jammu & Kashmir' }, { code: '02', name: 'Himachal Pradesh' }, { code: '03', name: 'Punjab' },
  { code: '04', name: 'Chandigarh' }, { code: '05', name: 'Uttarakhand' }, { code: '06', name: 'Haryana' }, { code: '07', name: 'Delhi' },
  { code: '08', name: 'Rajasthan' }, { code: '09', name: 'Uttar Pradesh' }, { code: '10', name: 'Bihar' }, { code: '11', name: 'Sikkim' },
  { code: '12', name: 'Arunachal Pradesh' }, { code: '13', name: 'Nagaland' }, { code: '14', name: 'Manipur' }, { code: '15', name: 'Mizoram' },
  { code: '16', name: 'Tripura' }, { code: '17', name: 'Meghalaya' }, { code: '18', name: 'Assam' }, { code: '19', name: 'West Bengal' },
  { code: '20', name: 'Jharkhand' }, { code: '21', name: 'Odisha' }, { code: '22', name: 'Chhattisgarh' }, { code: '23', name: 'Madhya Pradesh' },
  { code: '24', name: 'Gujarat' }, { code: '26', name: 'Dadra & Nagar Haveli and Daman & Diu' }, { code: '27', name: 'Maharashtra' },
  { code: '29', name: 'Karnataka' }, { code: '30', name: 'Goa' }, { code: '31', name: 'Lakshadweep' }, { code: '32', name: 'Kerala' },
  { code: '33', name: 'Tamil Nadu' }, { code: '34', name: 'Puducherry' }, { code: '35', name: 'Andaman & Nicobar Islands' },
  { code: '36', name: 'Telangana' }, { code: '37', name: 'Andhra Pradesh' }, { code: '38', name: 'Ladakh' }, { code: '97', name: 'Other Territory' },
];
export const stateName = (code?: string | null) => (code ? `${GST_STATES.find((s) => s.code === code)?.name ?? ''} (${code})` : '');

export const inrFmt = (n: number | string | null | undefined) =>
  `₹${Number(n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateFmt = (d?: string | null) => (d ? new Date(`${d.slice(0, 10)}T00:00:00+05:30`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '—');

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** 123456.5 → "Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six and Fifty Paise Only" */
export function amountInWords(n: number): string {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (x: number) => (x < 20 ? ones[x] : `${tens[Math.floor(x / 10)]}${x % 10 ? ` ${ones[x % 10]}` : ''}`);
  const three = (x: number) => `${x >= 100 ? `${ones[Math.floor(x / 100)]} Hundred${x % 100 ? ' ' : ''}` : ''}${x % 100 ? two(x % 100) : ''}`;
  const words = (x: number): string => {
    if (x === 0) return 'Zero';
    const parts: string[] = [];
    const crore = Math.floor(x / 10000000); x %= 10000000;
    const lakh = Math.floor(x / 100000); x %= 100000;
    const thousand = Math.floor(x / 1000); x %= 1000;
    if (crore) parts.push(`${words(crore)} Crore`);
    if (lakh) parts.push(`${two(lakh)} Lakh`);
    if (thousand) parts.push(`${two(thousand)} Thousand`);
    if (x) parts.push(three(x));
    return parts.join(' ');
  };
  const rupees = Math.floor(Math.abs(n));
  const paise = Math.round((Math.abs(n) - rupees) * 100);
  return `Rupees ${words(rupees)}${paise ? ` and ${two(paise)} Paise` : ''} Only`;
}

const STYLE = `
*{box-sizing:border-box} body{font-family:'Plus Jakarta Sans',system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#141729;margin:0;background:#eef0f5}
.page{max-width:820px;margin:24px auto;background:#fff;padding:40px 44px;border-radius:14px;box-shadow:0 10px 40px rgba(20,23,41,.08)}
.top{display:flex;justify-content:space-between;gap:24px;align-items:flex-start;border-bottom:2px solid #141729;padding-bottom:18px}
.brand{font-size:22px;font-weight:800;letter-spacing:-.01em} .muted{color:#5b6078;font-size:12px;line-height:1.55}
.doc{text-align:right} .doc h1{margin:0;font-size:20px;letter-spacing:.06em;text-transform:uppercase} .doc .no{font-family:ui-monospace,Menlo,monospace;font-size:14px;margin-top:6px;font-weight:700}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin:20px 0}
.box{border:1px solid #e3e5ee;border-radius:10px;padding:12px 14px} .box h3{margin:0 0 6px;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:#5b6078}
.box b{font-size:14px}
table{width:100%;border-collapse:collapse;font-size:12.5px;margin-top:6px} th{background:#f4f5f9;text-align:left;padding:8px;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:#5b6078}
td{padding:9px 8px;border-bottom:1px solid #eceef4;vertical-align:top} .r{text-align:right;white-space:nowrap}
.totals{margin-left:auto;width:320px;margin-top:12px;font-size:13px} .totals div{display:flex;justify-content:space-between;padding:5px 0}
.totals .grand{border-top:2px solid #141729;margin-top:4px;padding-top:8px;font-size:16px;font-weight:800}
.words{margin-top:12px;font-size:12px;font-style:italic;color:#3a3f5c}
.foot{display:grid;grid-template-columns:1.3fr 1fr;gap:18px;margin-top:26px;font-size:12px}
.sign{text-align:right;padding-top:40px} .sign .line{border-top:1px solid #141729;display:inline-block;padding-top:6px;min-width:200px}
.stamp{display:inline-block;margin-top:8px;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:800;letter-spacing:.08em}
.paid{background:#dcf8e8;color:#106b3c} .cancel{background:#ffe3e3;color:#a01b1b} .due{background:#fff3d6;color:#8a5a00}
.bar{max-width:820px;margin:16px auto 0;display:flex;justify-content:flex-end;gap:8px}
.bar button{font:inherit;font-weight:700;border:0;border-radius:10px;padding:10px 16px;cursor:pointer;background:#141729;color:#fff}
.bar button.ghost{background:#fff;color:#141729;border:1px solid #d6d9e4}
.note{font-size:11px;color:#5b6078;margin-top:18px;text-align:center}
@media print{body{background:#fff}.page{box-shadow:none;margin:0;max-width:none;border-radius:0;padding:0}.bar{display:none}@page{size:A4;margin:14mm}}
`;

function partyBox(title: string, p: any) {
  const addr = [p?.address, [p?.city, p?.pincode].filter(Boolean).join(' '), stateName(p?.state_code)].filter(Boolean).map(esc).join('<br>');
  return `<div class="box"><h3>${esc(title)}</h3><b>${esc(p?.legal_name)}</b>${p?.company_name && p.company_name !== p.legal_name ? `<div class="muted">${esc(p.company_name)}</div>` : ''}
    <div class="muted">${addr}</div>
    <div class="muted">${p?.gstin ? `GSTIN <b>${esc(p.gstin)}</b>` : 'Unregistered'}${p?.pan ? ` · PAN ${esc(p.pan)}` : ''}</div></div>`;
}

function shell(title: string, body: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${STYLE}</style></head>
<body><div class="bar"><button type="button" class="ghost" id="doc-close">Close</button><button type="button" id="doc-print">Download PDF / Print</button></div>
<div class="page">${body}</div><p class="note">Choose “Save as PDF” in the print window to download.</p></body></html>`;
}

function openWindow(): Window | null {
  const w = window.open('', '_blank');
  if (w) { w.document.write('<!doctype html><title>Loading…</title><p style="font-family:system-ui;padding:24px">Preparing document…</p>'); }
  return w;
}
function fill(w: Window | null, html: string) {
  if (!w) throw new Error('Allow pop-ups for this site to open the document.');
  w.document.open(); w.document.write(html); w.document.close();
  // The site's security policy blocks inline scripts, so the buttons are wired from here.
  w.document.getElementById('doc-print')?.addEventListener('click', () => { w.focus(); w.print(); });
  w.document.getElementById('doc-close')?.addEventListener('click', () => w.close());
}
function fail(w: Window | null, msg: string) {
  if (w) { w.document.open(); w.document.write(`<!doctype html><p style="font-family:system-ui;padding:24px">${esc(msg)}</p>`); w.document.close(); }
  throw new Error(msg);
}

export async function openInvoice(invoiceId: string) {
  const w = openWindow();
  const [{ data: v, error }, { data: lines }, { data: st }] = await Promise.all([
    db().from('invoices').select('*').eq('id', invoiceId).maybeSingle(),
    db().from('invoice_lines').select('*').eq('invoice_id', invoiceId).order('line_no'),
    db().from('invoice_status').select('settled, balance, payment_status, due_date').eq('id', invoiceId).maybeSingle(),
  ]);
  if (error || !v) return fail(w, 'Invoice not found or you do not have access.');
  const intra = v.supply_type === 'intra';
  const s = v.seller ?? {}; const b = v.buyer ?? {}; const bank = s.bank ?? {};
  const stamp = v.status === 'cancelled' ? '<span class="stamp cancel">CANCELLED</span>'
    : st?.payment_status === 'paid' ? '<span class="stamp paid">PAID</span>'
    : st?.payment_status === 'part_paid' ? `<span class="stamp due">PART PAID · ${esc(inrFmt(st.balance))} DUE</span>` : '';
  const rows = (lines ?? []).map((l: any) => `<tr><td>${l.line_no}</td><td>${esc(l.description)}</td><td>${esc(l.sac)}</td><td class="r">${Number(l.qty)}</td>
    <td class="r">${esc(inrFmt(l.unit_price))}</td><td class="r">${esc(inrFmt(l.taxable))}</td><td class="r">${Number(l.gst_rate)}%</td>
    ${intra ? `<td class="r">${esc(inrFmt(l.cgst))}</td><td class="r">${esc(inrFmt(l.sgst))}</td>` : `<td class="r">${esc(inrFmt(l.igst))}</td>`}
    <td class="r">${esc(inrFmt(l.total))}</td></tr>`).join('');
  const body = `
  <div class="top"><div><div class="brand">${esc(s.trade_name || s.legal_name)}</div><div class="muted">${esc(s.legal_name)}${s.email ? ` · ${esc(s.email)}` : ''}${s.phone ? ` · ${esc(s.phone)}` : ''}</div></div>
    <div class="doc"><h1>${esc(v.title)}</h1><div class="no">${esc(v.invoice_no)}</div><div class="muted">Date ${esc(dateFmt(v.issue_date))}${st?.due_date || v.due_date ? ` · Due ${esc(dateFmt(st?.due_date ?? v.due_date))}` : ''}</div>${stamp}</div></div>
  <div class="grid">${partyBox('From', s)}${partyBox('Bill to', b)}</div>
  <div class="muted">Place of supply: <b>${esc(stateName(v.place_of_supply))}</b> · ${intra ? 'Intra-state (CGST + SGST)' : 'Inter-state (IGST)'}${b.project ? ` · Project: ${esc(b.project)}` : ''}</div>
  <table><thead><tr><th>#</th><th>Description</th><th>SAC</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Taxable</th><th class="r">GST</th>
    ${intra ? '<th class="r">CGST</th><th class="r">SGST</th>' : '<th class="r">IGST</th>'}<th class="r">Total</th></tr></thead><tbody>${rows}</tbody></table>
  <div class="totals"><div><span>Taxable value</span><span>${esc(inrFmt(v.taxable_total))}</span></div>
    ${intra ? `<div><span>CGST</span><span>${esc(inrFmt(v.cgst_total))}</span></div><div><span>SGST</span><span>${esc(inrFmt(v.sgst_total))}</span></div>` : `<div><span>IGST</span><span>${esc(inrFmt(v.igst_total))}</span></div>`}
    <div class="grand"><span>Total</span><span>${esc(inrFmt(v.grand_total))}</span></div>
    ${st && Number(st.settled) > 0 && v.status !== 'cancelled' ? `<div><span>Received / adjusted</span><span>${esc(inrFmt(st.settled))}</span></div><div><b>Balance due</b><b>${esc(inrFmt(st.balance))}</b></div>` : ''}</div>
  <div class="words">${esc(amountInWords(Number(v.grand_total)))}</div>
  ${v.notes ? `<div class="muted" style="margin-top:8px">${esc(v.notes)}</div>` : ''}
  ${v.status === 'cancelled' ? `<div class="box" style="margin-top:14px;border-color:#f3b4b4"><b>Cancelled</b><div class="muted">${esc(v.cancel_reason)}</div></div>` : ''}
  <div class="foot"><div>${bank.account_number || bank.upi_id ? `<div class="box"><h3>Pay to</h3>
      ${bank.account_name ? `<div>${esc(bank.account_name)}</div>` : ''}${bank.bank_name ? `<div class="muted">${esc(bank.bank_name)}</div>` : ''}
      ${bank.account_number ? `<div class="muted">A/c ${esc(bank.account_number)}${bank.ifsc ? ` · IFSC ${esc(bank.ifsc)}` : ''}</div>` : ''}
      ${bank.upi_id ? `<div class="muted">UPI ${esc(bank.upi_id)}</div>` : ''}</div>` : ''}
      ${s.terms ? `<div class="muted" style="margin-top:10px;white-space:pre-wrap">${esc(s.terms)}</div>` : ''}</div>
    <div class="sign"><div class="muted">For ${esc(s.legal_name)}</div><br><br><span class="line">${esc(s.signatory || 'Authorised signatory')}</span></div></div>
  <p class="note">This is a computer-generated document.</p>`;
  fill(w, shell(`${v.title} ${v.invoice_no}`, body));
}

/** Opens the right document for a payment milestone: its invoice, or its debit note. */
export async function openForInstallment(installmentId: string) {
  const { data: v } = await db().from('invoices').select('id').eq('installment_id', installmentId).eq('status', 'issued').maybeSingle();
  if (v?.id) return openInvoice(v.id);
  const { data: a } = await db().from('invoice_adjustments').select('id').eq('installment_id', installmentId).eq('status', 'approved').maybeSingle();
  if (a?.id) return openNote(a.id);
  throw new Error('No invoice for this milestone yet.');
}

export async function openNote(adjustmentId: string) {
  const w = openWindow();
  const { data: a } = await db().from('invoice_adjustments').select('*').eq('id', adjustmentId).maybeSingle();
  if (!a || a.status !== 'approved') return fail(w, 'Note not found or not approved yet.');
  const { data: v } = await db().from('invoices').select('*').eq('id', a.invoice_id).maybeSingle();
  if (!v) return fail(w, 'Original invoice not found.');
  const intra = v.supply_type === 'intra'; const credit = a.kind === 'credit';
  const body = `
  <div class="top"><div><div class="brand">${esc(v.seller?.trade_name || v.seller?.legal_name)}</div><div class="muted">${esc(v.seller?.legal_name)}</div></div>
    <div class="doc"><h1>${credit ? 'Credit Note' : 'Debit Note'}</h1><div class="no">${esc(a.note_no)}</div><div class="muted">Date ${esc(dateFmt(a.issue_date))}</div>
    <div class="muted">Against invoice <b>${esc(v.invoice_no)}</b> dated ${esc(dateFmt(v.issue_date))}</div></div></div>
  <div class="grid">${partyBox('From', v.seller)}${partyBox(credit ? 'Issued to' : 'Bill to', v.buyer)}</div>
  <div class="muted">Place of supply: <b>${esc(stateName(v.place_of_supply))}</b></div>
  <table><thead><tr><th>Reason</th><th class="r">Taxable</th><th class="r">GST</th>${intra ? '<th class="r">CGST</th><th class="r">SGST</th>' : '<th class="r">IGST</th>'}<th class="r">Total</th></tr></thead>
    <tbody><tr><td>${esc(a.reason)}</td><td class="r">${esc(inrFmt(a.taxable))}</td><td class="r">${Number(a.gst_rate)}%</td>
    ${intra ? `<td class="r">${esc(inrFmt(a.cgst))}</td><td class="r">${esc(inrFmt(a.sgst))}</td>` : `<td class="r">${esc(inrFmt(a.igst))}</td>`}<td class="r">${esc(inrFmt(a.total))}</td></tr></tbody></table>
  <div class="totals"><div class="grand"><span>${credit ? 'Credited' : 'Payable'}</span><span>${esc(inrFmt(a.total))}</span></div>
    ${credit && Number(a.applied_to_invoice) > 0 ? `<div><span>Adjusted against ${esc(v.invoice_no)}</span><span>${esc(inrFmt(a.applied_to_invoice))}</span></div>` : ''}
    ${credit && Number(a.to_client_credit) > 0 ? `<div><span>Kept as your credit</span><span>${esc(inrFmt(a.to_client_credit))}</span></div>` : ''}
    ${!credit && a.due_date ? `<div><span>Due</span><span>${esc(dateFmt(a.due_date))}</span></div>` : ''}</div>
  <div class="words">${esc(amountInWords(Number(a.total)))}</div>
  <div class="foot"><div></div><div class="sign"><div class="muted">For ${esc(v.seller?.legal_name)}</div><br><br><span class="line">${esc(v.seller?.signatory || 'Authorised signatory')}</span></div></div>
  <p class="note">This is a computer-generated document.</p>`;
  fill(w, shell(`${credit ? 'Credit note' : 'Debit note'} ${a.note_no}`, body));
}

const METHOD: Record<string, string> = { bank_transfer: 'Bank transfer', upi: 'UPI', cheque: 'Cheque', card: 'Card', cash: 'Cash', other: 'Other' };

export async function openReceipt(receiptNo: string) {
  const w = openWindow();
  const { data: pays } = await db().from('payments').select('id, amount, reference, paid_on, method, installment_id, project_id, client_id, receipt_group, receipt_no, status')
    .eq('receipt_no', receiptNo).eq('status', 'Verified');
  if (!pays?.length) return fail(w, 'Receipt not found or you do not have access.');
  const clientId = pays[0].client_id; const group = pays[0].receipt_group;
  const instIds = pays.map((p: any) => p.installment_id);
  const [{ data: insts }, { data: credit }, { data: bp }, { data: cl }] = await Promise.all([
    db().from('payment_installments').select('id, name, invoice_number').in('id', instIds),
    group ? db().from('client_credit_ledger').select('amount').eq('receipt_group', group).eq('kind', 'overpayment') : Promise.resolve({ data: [] }),
    db().from('client_billing_profiles').select('*').eq('client_id', clientId).maybeSingle(),
    db().from('clients').select('company_name').eq('id', clientId).maybeSingle(),
  ]);
  const { data: seller } = await db().from('invoices').select('seller').eq('client_id', clientId).order('created_at', { ascending: false }).limit(1).maybeSingle();
  const s = seller?.seller ?? {};
  const toCredit = (credit ?? []).reduce((t: number, c: any) => t + Number(c.amount), 0);
  const total = pays.reduce((t: number, p: any) => t + Number(p.amount), 0) + toCredit;
  const nameOf = (id: string) => { const i = (insts ?? []).find((x: any) => x.id === id); return i ? `${i.invoice_number ? `${i.invoice_number} · ` : ''}${i.name}` : 'Milestone'; };
  const rows = pays.map((p: any) => `<tr><td>${esc(nameOf(p.installment_id))}</td><td class="r">${esc(inrFmt(p.amount))}</td></tr>`).join('')
    + (toCredit > 0 ? `<tr><td>Kept as advance / credit</td><td class="r">${esc(inrFmt(toCredit))}</td></tr>` : '');
  const buyer = bp ? { ...bp, company_name: cl?.company_name } : { legal_name: cl?.company_name };
  const body = `
  <div class="top"><div><div class="brand">${esc(s.trade_name || s.legal_name || 'Receipt')}</div><div class="muted">${esc(s.legal_name ?? '')}</div></div>
    <div class="doc"><h1>Payment Receipt</h1><div class="no">${esc(receiptNo)}</div><div class="muted">Received ${esc(dateFmt(pays[0].paid_on))}</div><span class="stamp paid">RECEIVED</span></div></div>
  <div class="grid">${s.legal_name ? partyBox('From', s) : '<div></div>'}${partyBox('Received from', buyer)}</div>
  <div class="muted">Mode: <b>${esc(METHOD[pays[0].method] ?? pays[0].method ?? '—')}</b> · Reference <b>${esc(pays[0].reference)}</b></div>
  <table><thead><tr><th>Against</th><th class="r">Amount</th></tr></thead><tbody>${rows}</tbody></table>
  <div class="totals"><div class="grand"><span>Total received</span><span>${esc(inrFmt(total))}</span></div></div>
  <div class="words">${esc(amountInWords(total))}</div>
  <div class="foot"><div></div><div class="sign"><div class="muted">${s.legal_name ? `For ${esc(s.legal_name)}` : ''}</div><br><br><span class="line">${esc(s.signatory || 'Authorised signatory')}</span></div></div>
  <p class="note">This is a computer-generated receipt.</p>`;
  fill(w, shell(`Receipt ${receiptNo}`, body));
}
