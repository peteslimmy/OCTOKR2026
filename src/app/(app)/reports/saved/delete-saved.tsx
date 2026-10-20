"use client";

import { apiRequest, ConfirmButton, useAction } from "@/components/ui/client";

export function DeleteSaved({ id }: { id: string }) {
  const { run } = useAction();
  return <ConfirmButton label="Delete" variant="secondary" title="Delete this saved view?" description="Only the saved view is removed. Snapshots and the reports themselves are not affected."
    onConfirm={() => run(() => apiRequest("DELETE", `saved-reports/${id}`), { success: "Saved view deleted." })} />;
}
