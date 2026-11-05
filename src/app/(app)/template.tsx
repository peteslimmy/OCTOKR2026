import type { ReactNode } from "react";

// A template re-mounts on every navigation, so each page eases in instead of snapping (the animation is the existing `page-enter`).
export default function AppTemplate({ children }: { children: ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
