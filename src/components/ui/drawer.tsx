"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode, RefObject } from "react";

/**
 * A panel that slides in from the right (full width on a phone) for looking closer at one thing without leaving the page.
 * Radix supplies the focus trap, Escape to close, scroll lock and labelling; focus returns to whatever opened it.
 */
export function Drawer({ open, onOpenChange, title, description, children, returnFocusTo }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string; children: ReactNode;
  /** The control that opened the drawer; it gets focus back on close (the drawer is opened from state, not from a trigger element). */
  returnFocusTo?: RefObject<HTMLElement | null>;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content onCloseAutoFocus={(e) => { if (returnFocusTo?.current) { e.preventDefault(); returnFocusTo.current.focus(); } }} className="page-enter fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col bg-panel shadow-xl">
          <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
            <div className="min-w-0">
              <Dialog.Title className="text-lg font-semibold text-ink">{title}</Dialog.Title>
              <Dialog.Description className={description ? "mt-1 text-sm text-muted" : "sr-only"}>{description ?? title}</Dialog.Description>
            </div>
            <Dialog.Close className="-m-2 rounded-lg p-2 text-muted hover:bg-surface hover:text-ink" aria-label="Close panel"><X className="h-5 w-5" aria-hidden /></Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
