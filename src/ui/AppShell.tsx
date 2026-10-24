import React, { useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ChevronsLeft, ChevronsRight, LogOut, MoreHorizontal, X } from 'lucide-react';
import { Avatar, cx } from './index';

export interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  badge?: number;
}
export interface NavGroup {
  label?: string;
  items: NavItem[];
}

const COLLAPSE_KEY = 'sigma.sidebar.collapsed';

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

function Badge({ n, active }: { n?: number; active?: boolean }) {
  if (!n || n <= 0) return null;
  return (
    <span
      className={cx(
        'min-w-5 h-5 px-1.5 rounded-full text-[10px] font-bold inline-flex items-center justify-center tnum',
        active ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-600'
      )}
    >
      {n > 99 ? '99+' : n}
    </span>
  );
}

function NavButton({ item, active, collapsed, onClick }: { item: NavItem; active: boolean; collapsed: boolean; onClick: () => void }) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      title={collapsed ? item.label : undefined}
      aria-current={active ? 'page' : undefined}
      className={cx(
        'group relative w-full flex items-center gap-3 rounded-full p-1.5 text-[13.5px] transition-colors duration-200',
        collapsed ? 'justify-center' : 'pr-3',
        active ? 'bg-brand-50/70 text-ink-950 font-bold' : 'text-ink-500 hover:text-ink-900 hover:bg-ink-50 font-semibold'
      )}
    >
      <span
        className={cx(
          'relative w-10 h-10 shrink-0 rounded-full inline-flex items-center justify-center transition-all duration-200',
          active ? 'bg-brand-600 text-white shadow-[0_8px_18px_-8px_rgb(91_53_232/0.8)]' : 'bg-transparent group-hover:bg-white'
        )}
      >
        <Icon className="w-[18px] h-[18px]" strokeWidth={active ? 2.2 : 1.9} />
        {collapsed && item.badge ? <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-rose-500 ring-2 ring-white" /> : null}
      </span>
      {!collapsed && (
        <>
          <span className="flex-1 min-w-0 truncate text-left">{item.label}</span>
          <Badge n={item.badge} active={active} />
        </>
      )}
    </button>
  );
}

export function AppShell({
  groups,
  active,
  onNavigate,
  user,
  onSignOut,
  topRight,
  banner,
  mobilePrimary,
  brand = 'sigma',
  children,
}: {
  brand?: 'sigma' | 'ira';
  groups: NavGroup[];
  active: string;
  onNavigate: (id: string) => void;
  user: { name: string; subtitle?: string; avatar?: string | null };
  onSignOut: () => void;
  topRight?: React.ReactNode;
  banner?: React.ReactNode;
  /** Up to four item ids shown in the mobile bottom bar; the rest go under "More". */
  mobilePrimary: string[];
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [sheetOpen, setSheetOpen] = useState(false);
  const allItems = groups.flatMap((g) => g.items);
  const primary = mobilePrimary.map((id) => allItems.find((i) => i.id === id)).filter(Boolean) as NavItem[];
  const moreActive = !primary.some((i) => i.id === active);
  const moreBadge = allItems.filter((i) => !mobilePrimary.includes(i.id)).reduce((s, i) => s + (i.badge ?? 0), 0);

  useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch {
      /* storage unavailable — keep in memory only */
    }
  }, [collapsed]);

  useEffect(() => {
    if (!sheetOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSheetOpen(false);
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [sheetOpen]);

  const go = (id: string) => {
    setSheetOpen(false);
    onNavigate(id);
  };

  return (
    <div className="min-h-dvh bg-[var(--app-bg)] text-ink-950">
      <div className="flex min-h-dvh">
        {/* Desktop sidebar */}
        <aside className="hidden lg:block sticky top-0 h-dvh shrink-0 py-4 pl-4">
          <div className={cx('card h-full flex flex-col transition-[width] duration-300 ease-[cubic-bezier(.2,.7,.2,1)]', collapsed ? 'w-[76px]' : 'w-[248px]')}>
            <div className={cx('flex items-center h-[76px] shrink-0', collapsed ? 'justify-center px-2' : 'px-6')}>
              {collapsed ? (
                (brand === 'sigma' ? <img src="/brand/sigma1-mark.svg" alt="SIGMA 1" className="w-8 h-8 object-contain" /> : <img src="/icon-192.png" alt="IRA Hospitality" className="w-10 h-10 object-contain" />)
              ) : (
                (brand === 'sigma' ? <img src="/brand/sigma1-wordmark.svg" alt="SIGMA 1" className="h-6 w-auto object-contain object-left" /> : <img src="/ira-logo-wordmark.png" alt="IRA Hospitality" className="h-9 w-auto object-contain object-left" />)
              )}
            </div>
            <nav className="flex-1 overflow-y-auto px-3 pb-3 space-y-5" aria-label="Main navigation">
              {groups.map((g, gi) => (
                <div key={g.label ?? gi} className="space-y-1">
                  {g.label && !collapsed && <p className="eyebrow px-3 pb-1 pt-1">{g.label}</p>}
                  {g.label && collapsed && gi > 0 && <div className="mx-4 my-2 h-px bg-ink-100" aria-hidden />}
                  {g.items.map((item) => (
                    <NavButton key={item.id} item={item} active={item.id === active} collapsed={collapsed} onClick={() => go(item.id)} />
                  ))}
                </div>
              ))}
            </nav>
            <div className="shrink-0 border-t border-ink-100 p-3 space-y-2">
              <div className={cx('flex items-center gap-3 rounded-2xl', collapsed ? 'justify-center' : 'px-1.5 py-1')}>
                <Avatar name={user.name} src={user.avatar} size={36} />
                {!collapsed && (
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-bold text-ink-900 truncate">{user.name}</p>
                    {user.subtitle && <p className="text-[11px] text-ink-500 truncate">{user.subtitle}</p>}
                  </div>
                )}
                {!collapsed && (
                  <button type="button" onClick={onSignOut} className="icon-btn !w-9 !h-9 hover:!text-rose-600 hover:!bg-rose-50" title="Sign out" aria-label="Sign out">
                    <LogOut className="w-4 h-4" />
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => setCollapsed((v) => !v)}
                className={cx('w-full flex items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold text-ink-400 hover:text-ink-800 hover:bg-ink-50 transition-colors', collapsed && 'justify-center')}
                aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              >
                {collapsed ? <ChevronsRight className="w-4 h-4" /> : <ChevronsLeft className="w-4 h-4" />}
                {!collapsed && 'Collapse'}
              </button>
              {collapsed && (
                <button type="button" onClick={onSignOut} className="w-full flex justify-center rounded-full py-2 text-ink-400 hover:text-rose-600 hover:bg-rose-50" title="Sign out" aria-label="Sign out">
                  <LogOut className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </aside>

        {/* Main column */}
        <div className="flex-1 min-w-0 flex flex-col">
          <header className="sticky top-0 z-40 bg-[var(--app-bg)]/85 backdrop-blur-md">
            <div className="h-16 lg:h-[76px] px-4 sm:px-6 lg:px-8 flex items-center gap-3">
              {brand === 'sigma' ? <img src="/brand/sigma1-wordmark.svg" alt="SIGMA 1" className="lg:hidden h-5 w-auto object-contain" /> : <img src="/ira-logo-wordmark.png" alt="IRA Hospitality" className="lg:hidden h-7 w-auto object-contain" />}
              <div className="flex-1" />
              {topRight}
              <div className="lg:hidden">
                <Avatar name={user.name} src={user.avatar} size={34} />
              </div>
            </div>
          </header>
          {banner && <div className="px-4 sm:px-6 lg:px-8 pb-2">{banner}</div>}
          <main className="flex-1 px-4 sm:px-6 lg:px-8 pt-1 pb-32 lg:pb-12">{children}</main>
        </div>
      </div>

      {/* Mobile bottom bar */}
      <nav className="lg:hidden fixed inset-x-3 bottom-3 z-50 pb-[env(safe-area-inset-bottom)]" aria-label="Quick navigation">
        <div className="mx-auto max-w-md rounded-full bg-ink-950 p-1.5 flex items-center justify-between shadow-[0_18px_40px_-12px_rgb(20_17_43/0.55)]">
          {primary.map((item) => {
            const Icon = item.icon;
            const on = item.id === active;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => go(item.id)}
                aria-label={item.label}
                aria-current={on ? 'page' : undefined}
                className={cx('relative flex-1 h-12 rounded-full inline-flex items-center justify-center gap-2 transition-colors duration-200', on ? 'bg-white text-ink-950' : 'text-white/70 hover:text-white')}
              >
                <Icon className="w-5 h-5" />
                {on && <span className="text-xs font-bold truncate max-w-[80px]">{item.label.split(' ')[0]}</span>}
                {!on && item.badge ? <span className="absolute top-2.5 right-[30%] w-2 h-2 rounded-full bg-rose-400" /> : null}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            aria-label="More"
            aria-expanded={sheetOpen}
            className={cx('relative flex-1 h-12 rounded-full inline-flex items-center justify-center gap-2 transition-colors', moreActive ? 'bg-white text-ink-950' : 'text-white/70 hover:text-white')}
          >
            <MoreHorizontal className="w-5 h-5" />
            {moreActive && <span className="text-xs font-bold">More</span>}
            {!moreActive && moreBadge > 0 && <span className="absolute top-2.5 right-[30%] w-2 h-2 rounded-full bg-rose-400" />}
          </button>
        </div>
      </nav>

      {/* Mobile "More" sheet */}
      <div className={cx('lg:hidden fixed inset-0 z-[60] transition-opacity duration-200', sheetOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none')} aria-hidden={!sheetOpen}>
        <button type="button" aria-label="Close menu" className="absolute inset-0 w-full h-full bg-ink-950/40 backdrop-blur-[2px]" onClick={() => setSheetOpen(false)} />
        <div
          role="dialog"
          aria-label="All pages"
          className={cx(
            'absolute inset-x-0 bottom-0 max-h-[82dvh] overflow-y-auto rounded-t-[32px] bg-white p-5 pb-[calc(20px+env(safe-area-inset-bottom))] transition-transform duration-300 ease-[cubic-bezier(.2,.7,.2,1)]',
            sheetOpen ? 'translate-y-0' : 'translate-y-full'
          )}
        >
          <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-ink-200" />
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3 min-w-0">
              <Avatar name={user.name} src={user.avatar} size={40} />
              <div className="min-w-0">
                <p className="text-sm font-bold truncate">{user.name}</p>
                {user.subtitle && <p className="text-xs text-ink-500 truncate">{user.subtitle}</p>}
              </div>
            </div>
            <button type="button" onClick={() => setSheetOpen(false)} className="icon-btn" aria-label="Close menu">
              <X className="w-5 h-5" />
            </button>
          </div>
          {groups.map((g, gi) => (
            <div key={g.label ?? gi} className="mb-4">
              {g.label && <p className="eyebrow mb-2 px-1">{g.label}</p>}
              <div className="grid grid-cols-3 gap-2">
                {g.items.map((item) => {
                  const Icon = item.icon;
                  const on = item.id === active;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => go(item.id)}
                      className={cx('relative flex flex-col items-center gap-2 rounded-2xl p-3 text-center text-[11px] font-semibold', on ? 'bg-brand-50 text-brand-800' : 'bg-ink-50 text-ink-600')}
                    >
                      <span className={cx('w-10 h-10 rounded-full inline-flex items-center justify-center', on ? 'bg-brand-600 text-white' : 'bg-white text-ink-600')}>
                        <Icon className="w-[18px] h-[18px]" />
                      </span>
                      <span className="leading-tight">{item.label}</span>
                      {item.badge ? <span className="absolute top-2 right-2"><Badge n={item.badge} /></span> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <button type="button" onClick={onSignOut} className="btn-danger w-full mt-1">
            <LogOut className="w-4 h-4" /> Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
