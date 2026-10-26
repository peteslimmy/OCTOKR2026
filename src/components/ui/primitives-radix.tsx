"use client";

import clsx from "clsx";
import type React from "react";
import * as AccordionPrimitive from "@radix-ui/react-accordion";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { ChevronDown, ChevronUp, ChevronsUpDown, X } from "lucide-react";
import { cn } from "./utils";

// Client-only components (Radix). Server pages import them through primitives.tsx, which re-exports this file.

// ---------------------------------------------------------------- Radix UI Primitives

// Accordion
export function Accordion({
  type = "single",
  collapsible,
  value,
  onValueChange,
  children,
  className,
}: { type?: "single" | "multiple"; collapsible?: boolean; value?: string | string[]; onValueChange?: (value: string | string[]) => void; children: React.ReactNode; className?: string }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return <AccordionPrimitive.Root type={type as any} collapsible={collapsible} value={value as any} onValueChange={onValueChange as any} className={className}>{children}</AccordionPrimitive.Root>;
}
export function AccordionItem({ value, className, children }: { value: string; className?: string; children: React.ReactNode }) {
  return <AccordionPrimitive.Item value={value} className={cn("border-b border-line", className)}>{children}</AccordionPrimitive.Item>;
}
export function AccordionTrigger({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger className={cn(
        "group flex flex-1 items-center justify-between py-3 text-sm font-medium transition-all hover:underline [&[data-state=open]>svg]:rotate-180",
        className,
      )}>
        {children}
        <ChevronDown className="h-4 w-4 shrink-0 text-muted transition-transform duration-200" aria-hidden />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  );
}
export function AccordionContent({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <AccordionPrimitive.Content className={cn("overflow-hidden text-sm data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down", className)}>
      <div className="pb-3 pt-1">{children}</div>
    </AccordionPrimitive.Content>
  );
}

// Popover
export function Popover({ open, onOpenChange, children }: { open?: boolean; onOpenChange?: (v: boolean) => void; children: React.ReactNode }) {
  return <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange} modal={false}>{children}</PopoverPrimitive.Root>;
}
export function PopoverTrigger({ children }: { children: React.ReactNode }) {
  return <PopoverPrimitive.Trigger asChild>{children}</PopoverPrimitive.Trigger>;
}
export function PopoverContent({ align = "center", side = "bottom", className, children }: { align?: "start" | "center" | "end"; side?: "top" | "right" | "bottom" | "left"; className?: string; children: React.ReactNode }) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content align={align} side={side} sideOffset={4}
        className={cn(
          "z-50 w-72 rounded-xl border border-line bg-panel p-3 shadow-xl data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in",
          className,
        )}
      >
        {children}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}

// Tooltip
export function Tooltip({ children, content }: { children: React.ReactNode; content: React.ReactNode }) {
  return (
    <TooltipPrimitive.Root delayDuration={200}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content side="top" sideOffset={6}
          className="z-50 max-w-xs rounded-lg bg-ink px-2 py-1 text-xs text-white shadow-xl">
          {content}
          <TooltipPrimitive.Arrow className="fill-ink" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

// Dialog / Modal
export function Dialog({ open, onOpenChange, children }: DialogPrimitive.DialogProps) {
  return <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>{children}</DialogPrimitive.Root>;
}
export function DialogTrigger({ children }: { children: React.ReactNode }) {
  return <DialogPrimitive.Trigger asChild>{children}</DialogPrimitive.Trigger>;
}
export function DialogContent({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="modal-overlay fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" />
      <DialogPrimitive.Content className={cn(
        "modal-content fixed top-1/2 left-1/2 z-50 max-h-[90vh] w-[calc(100%-32px)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-panel p-6 shadow-2xl",
        className,
      )}>
        {children}
        <DialogPrimitive.Close className="absolute right-3 top-3 rounded-lg p-1 text-muted hover:bg-surface" aria-label="Close">
          <X className="h-4 w-4" aria-hidden />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
export function DialogTitle({ children }: { children: React.ReactNode }) {
  return <DialogPrimitive.Title className="text-lg font-semibold text-ink">{children}</DialogPrimitive.Title>;
}
export function DialogDescription({ children }: { children: React.ReactNode }) {
  return <DialogPrimitive.Description className="mt-1 text-sm text-muted">{children}</DialogPrimitive.Description>;
}

// Note: Tabs, Select, and Checkbox are exported from their dedicated files:
// - tabs.tsx (Tabs, TabsList, TabsTrigger, TabsContent)
// - select.tsx (Select (Radix), SelectItem, SelectGroup, SelectSeparator)
// - checkbox.tsx (Checkbox, CheckboxLabel)
// These are re-exported from index.ts for convenience.

// Re-export Radix Select for use in pages that want advanced features
export { Select as RadixSelect } from "./select";
export { SelectItem, SelectGroup, SelectSeparator } from "./select";

// Separator

// Separator
export function Separator({ className }: { className?: string }) {
  return <div role="separator" className={cn("h-px bg-line", className)} />;
}

// Scroll area
export function ScrollArea({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("overflow-auto", className)}>{children}</div>;
}