"use client";

import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "./utils";

export function Select({ value, onValueChange, children, placeholder, ...p }: {
  value?: string; onValueChange?: (v: string) => void; placeholder?: string; children: React.ReactNode;
} & SelectPrimitive.SelectProps) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange} {...p}>
      <SelectPrimitive.Trigger
        className={cn(
          "flex h-10 w-full items-center justify-between rounded-lg border border-line bg-panel px-3 py-2 text-sm ring-offset-background placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-[var(--focus)] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon asChild><ChevronDown className="h-4 w-4 text-muted" aria-hidden /></SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content className="relative z-50 min-w-[8rem] overflow-hidden rounded-lg border border-line bg-panel shadow-xl">
          <SelectPrimitive.ScrollUpButton className="flex cursor-default items-center justify-center py-1"><ChevronUp className="h-4 w-4" /></SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className="flex cursor-default items-center justify-center py-1"><ChevronDown className="h-4 w-4" /></SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

export function SelectItem({ value, children }: { value: string; children: React.ReactNode }) {
  return (
    <SelectPrimitive.Item
      value={value}
      className={cn(
        "relative flex w-full cursor-default select-none items-center rounded-md py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-surface focus:text-ink data-[state=checked]:bg-surface",
      )}
    >
      <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator><Check className="h-4 w-4 text-brand-700" /></SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

export function SelectGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <SelectPrimitive.Group>
      <SelectPrimitive.Label className="px-2 py-1.5 text-xs font-semibold text-muted">{label}</SelectPrimitive.Label>
      {children}
    </SelectPrimitive.Group>
  );
}

export function SelectSeparator() {
  return <SelectPrimitive.Separator className="-mx-1 my-1 h-px bg-line" />;
}