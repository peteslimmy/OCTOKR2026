import type { ReactNode } from "react";
import { Card, PageHeader } from "@/components/ui/primitives";

/** What a 4COREPAL page shows when it cannot show its content (module off, no access, not found): a heading, so the screen is never without one, and the reason. */
export function Notice({ children }: { children: ReactNode }) {
  return (<><PageHeader title="4COREPAL" /><Card>{children}</Card></>);
}
