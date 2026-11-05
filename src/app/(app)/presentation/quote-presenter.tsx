"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Quote, X } from "lucide-react";
import { useState } from "react";
import { QuoteSlide, type QuoteSlideProps } from "@/components/quote-slide";

/** A button that puts the week's quote on the whole screen for the room; Esc or the close button returns to the presentation. */
export function QuotePresenter(props: Omit<QuoteSlideProps, "size">) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-line bg-panel px-4 py-2 text-sm font-medium hover:bg-surface">
        <Quote className="h-4 w-4" aria-hidden />Show quote
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/80" />
        <Dialog.Content className="fixed inset-0 z-50 flex flex-col justify-center outline-none">
          <Dialog.Title className="sr-only">Quote of the week</Dialog.Title>
          <Dialog.Description className="sr-only">{`“${props.quote}” by ${props.speaker}, ${props.businessUnit}`}</Dialog.Description>
          <Dialog.Close className="absolute right-4 top-4 z-10 inline-flex items-center gap-1.5 rounded-lg bg-black/55 px-3 py-2 text-sm font-medium text-white hover:bg-black/70" aria-label="Close the quote">
            <X className="h-4 w-4" aria-hidden />Close
          </Dialog.Close>
          <QuoteSlide {...props} size="hero" />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
