"use client";

import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import { cn } from "./utils";

export function Checkbox({ checked, onCheckedChange, ...p }: CheckboxPrimitive.CheckboxProps) {
  return (
    <CheckboxPrimitive.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      className={cn(
        "peer h-4 w-4 shrink-0 rounded border border-line bg-panel ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-brand-700 data-[state=checked]:bg-brand-700 data-[state=checked]:text-white",
      )}
      {...p}
    >
      <CheckboxPrimitive.Indicator className={cn("flex items-center justify-center text-white")}>
        <Check className="h-3 w-3" aria-hidden />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export function CheckboxLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70", className)}>{children}</span>;
}