"use client";

import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "./utils";

export function Tabs({ value, onValueChange, children, ...p }: TabsPrimitive.TabsProps) {
  return <TabsPrimitive.Root value={value} onValueChange={onValueChange} {...p}>{children}</TabsPrimitive.Root>;
}

export function TabsList({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <TabsPrimitive.List className={cn("inline-flex h-10 items-center gap-1 rounded-lg bg-surface p-1", className)}>
      {children}
    </TabsPrimitive.List>
  );
}

export function TabsTrigger({ value, children }: { value: string; children: React.ReactNode }) {
  return (
    <TabsPrimitive.Trigger
      value={value}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-panel data-[state=active]:text-ink data-[state=active]:shadow-sm",
      )}
    >
      {children}
    </TabsPrimitive.Trigger>
  );
}

export function TabsContent({ value, children }: { value: string; children: React.ReactNode }) {
  return (
    <TabsPrimitive.Content value={value} className="ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-2">
      {children}
    </TabsPrimitive.Content>
  );
}