"use client";

import { apiRequest, useAction } from "@/components/ui/client";
import { Button } from "@/components/ui/primitives";

export function MarkRead({ id }: { id: string }) {
  const { run, pending } = useAction();
  return <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => apiRequest("POST", `notifications/${id}/read`))}>Mark read</Button>;
}
export function MarkAllRead() {
  const { run, pending } = useAction();
  return <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => apiRequest("POST", "notifications/read-all"), { success: "All notifications marked read." })}>Mark all read</Button>;
}
