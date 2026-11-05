import { redirect } from "next/navigation";

// Violations now live in Violations & Funds. Old links and bookmarks forward to the Violations tab.
export default async function OldViolationsPage({ searchParams }: { searchParams: Promise<{ status?: string; new?: string }> }) {
  const sp = await searchParams;
  const q = new URLSearchParams({ tab: "violations" });
  if (sp.status) q.set("status", sp.status);
  if (sp.new) q.set("new", sp.new);
  redirect(`/violations?${q.toString()}`);
}
