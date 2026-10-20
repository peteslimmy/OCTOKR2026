"use client";

import { useRouter } from "next/navigation";
import { apiRequest, useAction } from "@/components/ui/client";
import { Button } from "@/components/ui/primitives";

export function StartReportButton({ weekId }: { weekId: string }) {
  const router = useRouter();
  const { run, pending } = useAction();
  return (
    <Button size="sm" disabled={pending}
      onClick={() => run(async () => {
        const id = await apiRequest<string>("POST", "weekly-reports", { reportingWeekId: weekId });
        router.push(`/weekly/${id}`);
      }, { refresh: false })}>
      {pending ? "Starting…" : "Start report"}
    </Button>
  );
}
