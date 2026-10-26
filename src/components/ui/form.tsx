"use client";

import * as LabelPrimitive from "@radix-ui/react-label";
import * as Slot from "@radix-ui/react-slot";
import { Controller, ControllerProps, FieldPath, FieldValues, useFormContext } from "react-hook-form";
import { cn } from "./utils";

export function FormLabel({ className, ...p }: LabelPrimitive.LabelProps) {
  return <LabelPrimitive.Root className={cn("text-sm font-medium text-ink", className)} {...p} />;
}

export function FormField<T extends FieldValues>({ ...props }: ControllerProps<T>) {
  return <Controller {...props} />;
}

export function FormItem({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("space-y-1.5", className)}>{children}</div>;
}

export function FormLabelWithHint({ label, hint, required, htmlFor }: { label: React.ReactNode; hint?: React.ReactNode; required?: boolean; htmlFor: string }) {
  return (
    <>
      <LabelPrimitive.Root htmlFor={htmlFor} className="text-sm font-medium text-ink">
        {label}
        {required && <span className="text-muted ml-1">(required)</span>}
      </LabelPrimitive.Root>
      {hint && <p id={`${htmlFor}-hint`} className="mt-1 text-xs text-muted">{hint}</p>}
    </>
  );
}

export function FormControl({ children, className, error }: { children: React.ReactNode; className?: string; error?: string }) {
  return (
    <div className={cn("", className)}>
      {children}
      {error && <p id={`${error}`} role="alert" className="mt-1 text-xs text-[var(--critical-fg)]">{error}</p>}
    </div>
  );
}

export function FormMessage({ message, className }: { message?: string; className?: string }) {
  return message ? <p className={cn("mt-1 text-xs text-[var(--critical-fg)]", className)}>{message}</p> : null;
}

// ---------------------------------------------------------------- Input
export function FormInput({ className, ...p }: React.InputHTMLAttributes<HTMLInputElement> & { error?: string }) {
  const { error, ...rest } = p;
  return (
    <>
      <input
        {...rest}
        className={cn(
          "flex h-10 w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          error && "border-[var(--critical-fg)] focus-visible:ring-[var(--critical-fg)]",
          className,
        )}
      />
      {error && <p role="alert" className="mt-1 text-xs text-[var(--critical-fg)]">{error}</p>}
    </>
  );
}

// ---------------------------------------------------------------- Textarea
export function FormTextarea({ className, ...p }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { error?: string }) {
  const { error, ...rest } = p;
  return (
    <>
      <textarea
        {...rest}
        className={cn(
          "flex min-h-[80px] w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm ring-offset-background placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          error && "border-[var(--critical-fg)] focus-visible:ring-[var(--critical-fg)]",
          className,
        )}
      />
      {error && <p role="alert" className="mt-1 text-xs text-[var(--critical-fg)]">{error}</p>}
    </>
  );
}

// ---------------------------------------------------------------- Select
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";

export function FormSelect({ value, onValueChange, className, placeholder, children, error, id, ...p }: {
  value?: string; onValueChange?: (v: string) => void; className?: string; placeholder?: string; children: React.ReactNode; error?: string; id?: string;
} & SelectPrimitive.SelectProps) {
  return (
    <>
      <SelectPrimitive.Root value={value} onValueChange={onValueChange} {...p}>
        <SelectPrimitive.Trigger id={id}
          className={cn(
            "flex h-10 w-full items-center justify-between rounded-lg border border-line bg-panel px-3 py-2 text-sm ring-offset-background placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
            error && "border-[var(--critical-fg)] focus-visible:ring-[var(--critical-fg)]",
            className,
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
      {error && <p role="alert" className="mt-1 text-xs text-[var(--critical-fg)]">{error}</p>}
    </>
  );
}

export function FormSelectItem({ value, children }: { value: string; children: React.ReactNode }) {
  return (
    <SelectPrimitive.Item value={value} className={cn(
      "relative flex w-full cursor-default select-none items-center rounded-md py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-surface focus:text-ink data-[state=checked]:bg-surface",
    )}>
      <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator><Check className="h-4 w-4 text-brand-700" /></SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

// ---------------------------------------------------------------- Checkbox
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";

export function FormCheckbox({ checked, onCheckedChange, className, error, ...p }: CheckboxPrimitive.CheckboxProps & { error?: string }) {
  return (
    <>
      <CheckboxPrimitive.Root
        checked={checked}
        onCheckedChange={onCheckedChange}
        className={cn(
          "peer h-4 w-4 shrink-0 rounded border border-line bg-panel ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-brand-700 data-[state=checked]:bg-brand-700 data-[state=checked]:text-white",
          error && "border-[var(--critical-fg)]",
          className,
        )}
        {...p}
      >
        <CheckboxPrimitive.Indicator className={cn("flex items-center justify-center text-white")}>
          <Check className="h-3 w-3" aria-hidden />
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      {error && <p role="alert" className="mt-1 text-xs text-[var(--critical-fg)]">{error}</p>}
    </>
  );
}

// ---------------------------------------------------------------- Switch
import * as SwitchPrimitive from "@radix-ui/react-switch";

export function FormSwitch({ checked, onCheckedChange, className, error, ...p }: SwitchPrimitive.SwitchProps & { error?: string }) {
  return (
    <>
      <SwitchPrimitive.Root
        checked={checked}
        onCheckedChange={onCheckedChange}
        className={cn(
          "peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-line bg-surface transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-brand-700 data-[state=checked]:border-brand-700",
          error && "border-[var(--critical-fg)]",
          className,
        )}
        {...p}
      >
        <SwitchPrimitive.Thumb className={cn("pointer-events-none block h-5 w-5 rounded-full bg-white shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-5")} />
      </SwitchPrimitive.Root>
      {error && <p role="alert" className="mt-1 text-xs text-[var(--critical-fg)]">{error}</p>}
    </>
  );
}

// ---------------------------------------------------------------- Radio Group
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";

export function FormRadioGroup({ value, onValueChange, children, className, error, ...p }: RadioGroupPrimitive.RadioGroupProps & { error?: string }) {
  return (
    <>
      <RadioGroupPrimitive.Root value={value} onValueChange={onValueChange} className={cn("", className)} {...p}>
        {children}
      </RadioGroupPrimitive.Root>
      {error && <p role="alert" className="mt-1 text-xs text-[var(--critical-fg)]">{error}</p>}
    </>
  );
}

export function FormRadioGroupItem({ value, children, className }: { value: string; children: React.ReactNode; className?: string }) {
  return (
    <RadioGroupPrimitive.Item value={value} className={cn("flex items-center gap-2", className)}>
      <RadioGroupPrimitive.Indicator className={cn(
        "h-4 w-4 rounded-full border border-line bg-panel flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-brand-700 data-[state=checked]:bg-brand-700",
      )}>
        <RadioGroupPrimitive.Indicator className={cn("h-2.5 w-2.5 rounded-full bg-white")} />
      </RadioGroupPrimitive.Indicator>
      <span className="text-sm font-medium">{children}</span>
    </RadioGroupPrimitive.Item>
  );
}