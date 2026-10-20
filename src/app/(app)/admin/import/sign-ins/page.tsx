import type { Metadata } from "next";
import Link from "next/link";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { can, requireActor } from "@/lib/auth/actor";
import { SignInWizard } from "./sign-in-wizard";

export const metadata: Metadata = { title: "Import sign-ins" };

export default async function Page() {
  const actor = await requireActor();
  if (!can(actor, "users.manage")) return <Card><EmptyState title="You do not have access to this import" /></Card>;
  return (
    <>
      <PageHeader title="Import sign-ins and roles" description="Give people who are already employees a sign-in and roles from a spreadsheet. Nobody chooses a password: each person receives a one-time link to set their own."
        actions={<Link href="/admin/import" className="text-sm text-brand-700 underline">Back to Import</Link>} />
      <SignInWizard />
    </>
  );
}
