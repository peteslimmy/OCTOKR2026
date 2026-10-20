"use client";

import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";

/** The welcome banner at the top of the dashboard: a greeting, today, and one-click shortcuts to the jobs people come here to do. */
export function Hero({ name, actions }: { name: string; actions: { href: string; label: string }[] }) {
  const reduce = useReducedMotion();
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Africa/Lagos" }).format(new Date()));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const today = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Lagos" }).format(new Date());
  return (
    <motion.section aria-labelledby="hero-h" className="hero mb-8 p-6 sm:p-8" initial={reduce ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 160, damping: 22 }}>
      <p className="text-sm font-medium text-white/80" suppressHydrationWarning>{today}</p>
      <h1 id="hero-h" className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl" suppressHydrationWarning>{greeting}, {name}</h1>
      <p className="mt-2 max-w-2xl text-sm text-white/85">What needs attention, what is locked, and where each score comes from.</p>
      {actions.length > 0 ? (
        <ul className="mt-5 flex flex-wrap gap-2" aria-label="Shortcuts">
          {actions.map((a, i) => (
            <motion.li key={a.href} initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 + i * 0.05, type: "spring", stiffness: 240, damping: 24 }}>
              <Link href={a.href} className="inline-flex items-center rounded-xl bg-white/15 px-4 py-2 text-sm font-medium text-white ring-1 ring-white/30 backdrop-blur transition hover:bg-white hover:text-brand-800">{a.label}</Link>
            </motion.li>
          ))}
        </ul>
      ) : null}
    </motion.section>
  );
}
