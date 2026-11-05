"use client";

import * as Dialog from "@radix-ui/react-dialog";
import clsx from "clsx";
import {
  AlertTriangle, Banknote, Bell, BookOpen, Bookmark, Building2, CalendarDays, ChevronDown, FileBarChart, FileClock, Flag, Inbox, Landmark, LayoutDashboard, Lightbulb, ListChecks,
  Lock, LogOut, Menu, NotebookPen, Palette, PanelLeftClose, PanelLeftOpen, PanelsTopLeft, Presentation, ScrollText, Search, ShieldCheck, SlidersHorizontal, Target, TrendingUp, Upload, UserCog, Users, Wallet, Wrench, X,
} from "lucide-react";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { apiRequest, Countdown } from "@/components/ui/client";
import { BrandLogo } from "@/components/brand-logo";

const ICONS = {
  dashboard: LayoutDashboard, strategy: Target, weekly: ListChecks, performance: TrendingUp, presentation: Presentation, reports: FileBarChart, insights: Lightbulb,
  builder: Wrench, saved: Bookmark, governance: Landmark, violations: AlertTriangle, amendments: FileClock, finance: Wallet, ledger: BookOpen, disbursement: Banknote,
  units: Building2, people: Users, roles: ShieldCheck, import: Upload, calendar: CalendarDays, settings: SlidersHorizontal, approvals: Inbox, branding: Palette, audit: ScrollText,
  account: UserCog, site: PanelsTopLeft, bugoals: Flag, notes: NotebookPen,
} as const;
export type IconName = keyof typeof ICONS;
export interface NavItem { href: string; label: string; icon: IconName; hint?: string; exact?: boolean }
export interface NavGroup { label: string; items: NavItem[] }
export interface CreateItem { href: string; label: string; hint: string }
/** An upcoming deadline shown in the header: the content lock of an open week or the final lock of a week still being executed. */
export interface LockChip { key: string; kind: "content" | "final"; weekNumber: number; at: string; atText: string }

export interface Brand { name: string; shortName: string; logoUrl: string | null; logoHeight?: number }

const STORE = "okr.nav.collapsed";
// Which groups the person collapsed is a per-browser convenience, read without an effect so the server render stays stable.
const subscribeNav = (cb: () => void) => { window.addEventListener("okr-nav", cb); return () => window.removeEventListener("okr-nav", cb); };
const readNav = () => { try { return localStorage.getItem(STORE) ?? "[]"; } catch { return "[]"; } };
const SIDEBAR = "okr.sidebar.hidden";
const readSidebar = () => { try { return localStorage.getItem(SIDEBAR) === "1"; } catch { return false; } };
const matches = (path: string, href: string) => path === href || path.startsWith(href + "/");

export function Shell({ groups, create, brand, user, quarterLabel, locks = [], unread, children }: {
  groups: NavGroup[]; create: CreateItem[]; brand: Brand; user: { name: string; roles: string[]; bu: string | null }; quarterLabel: string | null; locks?: LockChip[]; unread: number; children: ReactNode;
}) {
  const path = usePathname();
  const router = useRouter();
  // menus belong to the page they were opened on, so moving to another page closes them
  const [openFor, setOpenFor] = useState<string | null>(null);
  const open = openFor === path;
  const setOpen = (v: boolean) => setOpenFor(v ? path : null);
  const rawCollapsed = useSyncExternalStore(subscribeNav, readNav, () => "[]");
  const collapsed = useMemo<string[]>(() => { try { return JSON.parse(rawCollapsed) as string[]; } catch { return []; } }, [rawCollapsed]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const sidebarHidden = useSyncExternalStore(subscribeNav, readSidebar, () => false);
  const toggleSidebar = () => {
    try { localStorage.setItem(SIDEBAR, sidebarHidden ? "0" : "1"); } catch { /* preferences are optional */ }
    window.dispatchEvent(new Event("okr-nav"));
  };

  const toggle = (label: string) => {
    const next = collapsed.includes(label) ? collapsed.filter((x) => x !== label) : [...collapsed, label];
    try { localStorage.setItem(STORE, JSON.stringify(next)); } catch { /* preferences are optional */ }
    window.dispatchEvent(new Event("okr-nav"));
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen(true); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  const reduceMotion = useReducedMotion();
  const renderLinks = (prefix: string) => (
    <nav aria-label="Primary" className="flex flex-col gap-3 p-3">
      {groups.map((g) => {
        const hasActive = g.items.some((n) => (n.exact ? path === n.href : matches(path, n.href)));
        const isCollapsed = collapsed.includes(g.label) && !hasActive;
        return (
          <div key={g.label}>
            <button type="button" onClick={() => toggle(g.label)} aria-expanded={!isCollapsed}
              className="flex w-full items-center justify-between rounded-md px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted hover:text-ink">
              {g.label}<ChevronDown className={clsx("h-3.5 w-3.5 transition-transform", isCollapsed && "-rotate-90")} aria-hidden />
            </button>
            {isCollapsed ? null : (
              <ul className="mt-1 flex flex-col gap-0.5">
                {g.items.map((n) => {
                  const Icon = ICONS[n.icon];
                  // the most specific item wins so /admin/units does not light up "Administration" as well
                  const active = (n.exact ? path === n.href : matches(path, n.href)) && !g.items.some((o) => o.href.length > n.href.length && matches(path, o.href));
                  return (
                    <li key={n.href}>
                      <Link href={n.href} onClick={() => setOpen(false)} aria-current={active ? "page" : undefined} title={n.hint}
                        className={clsx("relative flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors", active ? "text-brand-800" : "text-ink hover:bg-surface")}>
                        {active ? <motion.span layoutId={`${prefix}-nav-pill`} aria-hidden className="absolute inset-0 rounded-lg bg-brand-100 shadow-[inset_3px_0_0_var(--brand-700)]" transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 34 }} /> : null}
                        <Icon className="relative h-4 w-4 shrink-0" aria-hidden /> <span className="relative">{n.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-white focus:p-2">Skip to content</a>
      <header className="glass sticky top-0 z-30 flex min-h-14 items-center py-1 gap-3 border-b border-line px-4">
        <button className="rounded-lg p-2 hover:bg-surface lg:hidden" aria-label="Open navigation" aria-expanded={open} onClick={() => setOpen(true)}>
          <Menu className="h-5 w-5" aria-hidden />
        </button>
        <button type="button" className="hidden rounded-lg p-2 hover:bg-surface lg:inline-flex" onClick={toggleSidebar} aria-pressed={sidebarHidden}
          aria-label={sidebarHidden ? "Show navigation sidebar" : "Hide navigation sidebar"} title={sidebarHidden ? "Show sidebar" : "Hide sidebar"}>
          {sidebarHidden ? <PanelLeftOpen className="h-5 w-5" aria-hidden /> : <PanelLeftClose className="h-5 w-5" aria-hidden />}
        </button>
        <Link href="/dashboard" aria-label={`${brand.name}: dashboard`} className="flex flex-col items-start gap-0.5 font-semibold leading-none">
          {brand.logoUrl
            ? <BrandLogo src={brand.logoUrl} height={brand.logoHeight} />
            : <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-700 text-sm font-bold text-white" aria-hidden>{brand.shortName}</span>}
          <span className="max-w-[14rem] truncate text-[11px] tracking-tight text-ink">{brand.name}</span>
        </Link>
        {quarterLabel ? <span className="hidden rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-800 sm:inline">{quarterLabel}</span> : null}
        {locks.length > 0 ? (
          <ul className="hidden shrink-0 items-center gap-1.5 xl:flex" aria-label="Upcoming locks">
            {locks.map((l) => (
              <li key={l.key} className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-surface px-3 py-1 text-xs text-ink" title={`Week ${l.weekNumber}: ${l.kind === "content" ? "content lock" : "final lock"} ${l.atText} WAT`}>
                <Lock className="h-3.5 w-3.5 text-muted" aria-hidden />
                <Countdown to={l.at} label={`Wk ${l.weekNumber} ${l.kind === "content" ? "content lock" : "final lock"}`} />
              </li>
            ))}
          </ul>
        ) : null}

        <button type="button" onClick={() => setPaletteOpen(true)}
          className="ml-2 hidden min-w-56 items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-muted hover:border-brand-700 md:flex" aria-label="Search pages and actions">
          <Search className="h-4 w-4" aria-hidden /> Search or jump to…<kbd className="ml-auto rounded border border-line bg-panel px-1.5 text-[10px]">Ctrl K</kbd>
        </button>

        <div className="ml-auto flex items-center gap-2">
          <button type="button" className="rounded-lg p-2 hover:bg-surface md:hidden" aria-label="Search pages and actions" onClick={() => setPaletteOpen(true)}><Search className="h-5 w-5" aria-hidden /></button>
          {user.bu ? <span className="hidden text-sm text-muted xl:inline">{user.bu}</span> : null}
          <Link href="/notifications" className="relative rounded-lg p-2 hover:bg-surface" aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}>
            <Bell className="h-5 w-5" aria-hidden />
            {unread > 0 ? <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-700 px-1 text-[10px] font-semibold text-white">{unread > 9 ? "9+" : unread}</span> : null}
          </Link>
          <Link href="/account/security" className="hidden rounded-lg px-2 py-1 text-right leading-tight hover:bg-surface sm:block" title="Account security">
            <p className="text-sm font-medium">{user.name}</p>
            <p className="text-xs text-muted">{user.roles.map((r) => r.replace("_", " ").toLowerCase()).join(", ")}</p>
          </Link>
          <button className="rounded-lg p-2 hover:bg-surface" aria-label="Sign out"
            onClick={async () => { await apiRequest("POST", "auth/logout").catch(() => undefined); router.replace("/login"); router.refresh(); }}>
            <LogOut className="h-5 w-5" aria-hidden />
          </button>
        </div>
      </header>

      <div className="flex">
        <aside className={clsx("sticky top-14 hidden h-[calc(100vh-56px)] w-64 shrink-0 overflow-y-auto border-r border-line bg-panel/90 backdrop-blur", !sidebarHidden && "lg:block")}>{renderLinks("d")}</aside>
        {open ? (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} aria-hidden />
            <aside className="absolute inset-y-0 left-0 w-72 overflow-y-auto bg-panel shadow-xl" role="dialog" aria-modal="true" aria-label="Navigation">
              <div className="flex justify-end p-2"><button className="rounded-lg p-2 hover:bg-surface" aria-label="Close navigation" onClick={() => setOpen(false)}><X className="h-5 w-5" aria-hidden /></button></div>
              {renderLinks("m")}
            </aside>
          </div>
        ) : null}
        <main id="main" className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
      <Palette_ open={paletteOpen} onOpenChange={setPaletteOpen} groups={groups} create={create} onGo={(href) => { setPaletteOpen(false); router.push(href); }} />
    </div>
  );
}

// Jump-to: every page and every create action the person may use, filtered as they type.
function Palette_({ open, onOpenChange, groups, create, onGo }: { open: boolean; onOpenChange: (v: boolean) => void; groups: NavGroup[]; create: CreateItem[]; onGo: (href: string) => void }) {
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const entries = useMemo(() => [
    ...create.map((c) => ({ href: c.href, label: c.label, sub: "Create" })),
    ...groups.flatMap((g) => g.items.map((n) => ({ href: n.href, label: n.label, sub: `${g.label}${n.hint ? ` · ${n.hint}` : ""}` }))),
  ], [groups, create]);
  const shown = entries.filter((e) => `${e.label} ${e.sub}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 12);
  return (
    <Dialog.Root open={open} onOpenChange={(v) => { if (!v) { setQ(""); setIdx(0); } onOpenChange(v); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content className="fixed top-24 left-1/2 z-50 w-[min(92vw,34rem)] -translate-x-1/2 rounded-xl border border-line bg-panel shadow-2xl" aria-describedby={undefined}>
          <Dialog.Title className="sr-only">Search pages and actions</Dialog.Title>
          <div className="flex items-center gap-2 border-b border-line px-4 py-3">
            <Search className="h-4 w-4 text-muted" aria-hidden />
            <input autoFocus value={q} onChange={(e) => { setQ(e.target.value); setIdx(0); }} placeholder="Go to a page or start an action…" aria-label="Search" className="w-full bg-transparent text-sm outline-none"
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(i + 1, shown.length - 1)); }
                if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
                if (e.key === "Enter" && shown[idx]) { const go = shown[idx].href; setQ(""); setIdx(0); onGo(go); }
              }} />
          </div>
          <ul className="max-h-80 overflow-y-auto p-1" role="listbox" aria-label="Results">
            {shown.length === 0 ? <li className="px-3 py-6 text-center text-sm text-muted">Nothing matches “{q}”.</li> : shown.map((e, i) => (
              <li key={`${e.href}-${e.label}`} role="option" aria-selected={i === idx}>
                <button type="button" onClick={() => { setQ(""); setIdx(0); onGo(e.href); }} onMouseEnter={() => setIdx(i)}
                  className={clsx("flex w-full flex-col rounded-lg px-3 py-2 text-left", i === idx ? "bg-brand-50" : "hover:bg-surface")}>
                  <span className="text-sm font-medium">{e.label}</span><span className="text-xs text-muted">{e.sub}</span>
                </button>
              </li>
            ))}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
