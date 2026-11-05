import type { Metadata } from "next";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { SettingsPanel } from "@/components/executive-oversight/settings-panel";
import { requireActor } from "@/lib/auth/actor";
import { listCategories, listRules } from "@/lib/data/executive-oversight";
import { adminClient } from "@/lib/supabase/admin";
import { eoCaps } from "@/lib/executive-oversight/caps";

export const metadata: Metadata = { title: "Executive oversight settings" };

export default async function OversightSettingsPage() {
  const actor = await requireActor();
  if (!eoCaps(actor).configure) return <Card><EmptyState title="These settings are managed by an administrator" /></Card>;
  const [categories, rules, roles] = await Promise.all([listCategories(), listRules(), adminClient().from("roles").select("code, name").order("name").then((r) => r.data ?? [])]);
  return (
    <>
      <PageHeader title="Executive oversight settings" description="The comment categories and the reminder timeline. This page gives no access to executive comments or recommendations." />
      <SettingsPanel categories={categories} rules={rules} roles={roles as { code: string; name: string }[]} />
    </>
  );
}
