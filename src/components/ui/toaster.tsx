"use client";

import { Toaster, toast } from "sonner";

export function AppToaster() {
  return (
    <Toaster
      position="bottom-right"
      richColors
      expand={false}
      visibleToasts={5}
      gap={8}
      duration={4000}
      theme="light"
      style={{ "--sonner-font-size": "14px" } as React.CSSProperties}
    />
  );
}

export function useToast() {
  return toast;
}