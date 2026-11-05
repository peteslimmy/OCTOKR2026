import { redirect } from "next/navigation";

// The violation fund now lives in Violations & Funds. Old links and bookmarks forward to the Fund tab.
export default async function OldFinancePage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const sp = await searchParams;
  redirect(`/violations?tab=fund${sp.new ? `&new=${encodeURIComponent(sp.new)}` : ""}`);
}
