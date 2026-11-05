import { redirect } from "next/navigation";

// The ledger now lives in Violations & Funds, under the Fund tab.
export default function OldLedgerPage() {
  redirect("/violations?tab=fund&view=ledger");
}
