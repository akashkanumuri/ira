import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Building2, CornerDownLeft, FileSignature, FileText, FolderKanban, ListChecks, Package, Receipt, Search, Users, X } from 'lucide-react';
import { KIND_LABEL, globalSearch, type SearchHit, type SearchKind } from '../../lib/search';
import { cx } from '../../ui';

const ICON: Record<SearchKind, React.ReactNode> = {
  client: <Building2 className="w-4 h-4" />, project: <FolderKanban className="w-4 h-4" />, contract: <FileSignature className="w-4 h-4" />,
  deliverable: <Package className="w-4 h-4" />, invoice: <Receipt className="w-4 h-4" />, task: <ListChecks className="w-4 h-4" />,
  file: <FileText className="w-4 h-4" />, employee: <Users className="w-4 h-4" />,
};
const ORDER: SearchKind[] = ['client', 'project', 'deliverable', 'task', 'contract', 'invoice', 'employee', 'file'];
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** Search button for the top bar plus the ⌘K / Ctrl K palette. */
export function GlobalSearch({ role, onNavigate }: { role: string; onNavigate: (to: string) => void }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) { e.preventDefault(); setOpen((o) => !o); }
      else if (e.key === '/' && !typing) { e.preventDefault(); setOpen(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="hidden sm:inline-flex items-center gap-2 h-10 pl-3.5 pr-2 rounded-full bg-white border border-ink-200 text-[13px] text-ink-400 hover:border-ink-300 hover:text-ink-600 transition-colors min-w-[220px]" aria-label="Search">
        <Search className="w-4 h-4" /><span className="flex-1 text-left">Search everything</span>
        <kbd className="text-[11px] font-semibold text-ink-400 bg-ink-50 border border-ink-100 rounded-md px-1.5 py-0.5">{isMac ? '⌘' : 'Ctrl'} K</kbd>
      </button>
      <button type="button" onClick={() => setOpen(true)} className="sm:hidden icon-btn icon-btn-surface" aria-label="Search"><Search className="w-4 h-4" /></button>
      {open && <Palette role={role} onClose={() => setOpen(false)} onNavigate={(to) => { setOpen(false); onNavigate(to); }} />}
    </>
  );
}

function Palette({ role, onClose, onNavigate }: { role: string; onClose: () => void; onNavigate: (to: string) => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  useEffect(() => { input.current?.focus(); const prev = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = prev; }; }, []);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setHits([]); setLoading(false); return; }
    setLoading(true);
    const id = ++seq.current;
    const t = window.setTimeout(async () => {
      const r = await globalSearch(term, role);
      if (id !== seq.current) return; // a newer search started
      setHits(r);
      setActive(0);
      setLoading(false);
    }, 220);
    return () => window.clearTimeout(t);
  }, [q, role]);

  const grouped = useMemo(() => ORDER.map((k) => ({ kind: k, items: hits.filter((h) => h.kind === k) })).filter((g) => g.items.length), [hits]);
  const flat = useMemo(() => grouped.flatMap((g) => g.items), [grouped]);

  const go = (h: SearchHit | undefined) => { if (h?.to) onNavigate(h.to); };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(flat.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); go(flat[active]); }
  };
  useEffect(() => { document.getElementById(`search-hit-${active}`)?.scrollIntoView({ block: 'nearest' }); }, [active]);

  let index = -1;
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-start justify-center p-3 sm:p-6 sm:pt-[12vh]" role="dialog" aria-modal="true" aria-label="Search">
      <div className="absolute inset-0 bg-ink-950/30 backdrop-blur-[2px] anim-fade" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-white rounded-[28px] shadow-2xl border border-ink-100 overflow-hidden anim-slide" onKeyDown={onKeyDown}>
        <div className="flex items-center gap-3 px-5 h-16 border-b border-ink-100">
          <Search className="w-5 h-5 text-ink-400 shrink-0" />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder={role === 'admin' ? 'Search clients, projects, deliverables, tasks, invoices, people…' : 'Search your projects, deliverables and tasks…'}
            className="flex-1 h-full bg-transparent outline-none text-[15px] text-ink-900 placeholder:text-ink-400" aria-label="Search" aria-controls="search-results" aria-activedescendant={flat.length ? `search-hit-${active}` : undefined} />
          {loading && <span className="w-4 h-4 rounded-full border-2 border-ink-200 border-t-brand-500 animate-spin" aria-label="Searching" />}
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close search"><X className="w-4 h-4" /></button>
        </div>
        <div id="search-results" role="listbox" className="max-h-[60vh] overflow-y-auto py-2">
          {q.trim().length < 2 ? (
            <p className="px-5 py-8 text-center text-[13px] text-ink-400">Type at least two letters. You’ll only see what you already have access to.</p>
          ) : !loading && !flat.length ? (
            <p className="px-5 py-8 text-center text-[13px] text-ink-500">Nothing matches “{q.trim()}”.</p>
          ) : grouped.map((g) => (
            <div key={g.kind} className="py-1">
              <p className="px-5 pt-2 pb-1 eyebrow">{KIND_LABEL[g.kind]}</p>
              {g.items.map((h) => {
                index += 1;
                const i = index;
                return (
                  <button key={`${h.kind}-${h.id}`} id={`search-hit-${i}`} type="button" role="option" aria-selected={i === active} disabled={!h.to}
                    onMouseEnter={() => setActive(i)} onClick={() => go(h)}
                    className={cx('w-full text-left flex items-center gap-3 px-5 py-2.5 transition-colors', i === active ? 'bg-brand-50' : 'hover:bg-ink-50', !h.to && 'opacity-60 cursor-default')}>
                    <span className={cx('w-9 h-9 rounded-xl grid place-items-center shrink-0', i === active ? 'bg-white text-brand-600' : 'bg-ink-50 text-ink-500')}>{ICON[h.kind]}</span>
                    <span className="min-w-0 flex-1"><span className="block text-[14px] font-semibold text-ink-900 truncate">{h.title}</span>{h.subtitle && <span className="block text-[12px] text-ink-500 truncate">{h.subtitle}</span>}</span>
                    {i === active && h.to && <CornerDownLeft className="w-4 h-4 text-brand-500 shrink-0" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="hidden sm:flex items-center gap-4 px-5 h-10 border-t border-ink-100 text-[11px] text-ink-400">
          <span><kbd className="font-semibold">↑↓</kbd> move</span><span><kbd className="font-semibold">Enter</kbd> open</span><span><kbd className="font-semibold">Esc</kbd> close</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
