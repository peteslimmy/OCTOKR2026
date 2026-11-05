import { redirect } from "next/navigation";

/** The executive report is now the management brief itself; this keeps old links working. */
export default async function ReportMoved({ searchParams }: { searchParams: Promise<{ quarter?: string }> }) {
  const sp = await searchParams;
  redirect(sp.quarter ? `/insights?quarter=${encodeURIComponent(sp.quarter)}` : "/insights");
}
