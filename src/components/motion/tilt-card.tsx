"use client";

import clsx from "clsx";
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import type { ReactNode } from "react";

/** A card that lifts on hover, tilts a few degrees towards the pointer and carries a soft light that follows it. Flat when reduced motion is requested. */
export function TiltCard({ children, className }: { children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const rotX = useSpring(useTransform(py, [0, 1], [5, -5]), { stiffness: 180, damping: 18 });
  const rotY = useSpring(useTransform(px, [0, 1], [-5, 5]), { stiffness: 180, damping: 18 });
  if (reduce) return <div className={clsx("premium-card", className)}>{children}</div>;
  return (
    <motion.div
      className={clsx("premium-card relative", className)}
      style={{ rotateX: rotX, rotateY: rotY, transformPerspective: 900 }}
      whileHover={{ y: -4, boxShadow: "0 18px 40px -18px rgb(16 24 40 / 0.35)" }}
      transition={{ type: "spring", stiffness: 260, damping: 22 }}
      onPointerMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); px.set((e.clientX - r.left) / r.width); py.set((e.clientY - r.top) / r.height); }}
      onPointerLeave={() => { px.set(0.5); py.set(0.5); }}
    >
      <div className="relative">{children}</div>
    </motion.div>
  );
}
