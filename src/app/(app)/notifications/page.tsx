import type { Metadata } from "next";
import { wat } from "@/components/status";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import Link from "next/link";
import { listNotifications } from "@/lib/data";
import { notificationAction } from "@/lib/notification-actions";
import { userClient } from "@/lib/supabase/server";
import { requireActor } from "@/lib/auth/actor";
import { EmailPreference } from "./email-preference";
import { MarkAllRead, MarkRead } from "./notification-actions";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const actor = await requireActor();
  const sb = await userClient();
  const { data: pref } = await sb.from("notification_preferences").select("email_enabled").eq("user_id", actor.id).maybeSingle();
  const items = await listNotifications(100);
  const unread = items.filter((i) => !i.read_at).length;
  return (
    <>
      <PageHeader title="Notifications" description="Persistent business events. Email, when enabled, is a secondary channel." actions={unread ? <MarkAllRead /> : undefined} />
      <EmailPreference initial={pref?.email_enabled ?? true} />
      <Card>
        {items.length === 0 ? <EmptyState title="You are all caught up">Reporting, lock and integrity events will appear here.</EmptyState> : (
          <ul className="divide-y divide-line">
            {items.map((n) => (
              <li key={n.id} className="flex items-start justify-between gap-4 px-6 py-4">
                <div>
                  <p className={n.read_at ? "text-sm" : "text-sm font-semibold"}>{!n.read_at ? <><span className="mr-2 inline-block h-2 w-2 rounded-full bg-brand-700" aria-hidden /><span className="sr-only">Unread: </span></> : null}{n.title}</p>
                  <p className="mt-1 text-sm text-muted">{n.message}</p>
                  <p className="mt-1 text-xs text-muted">{wat(n.created_at)}</p>
                  {n.state ? <p className="mt-2"><Badge tone={n.state === "WAITING" ? "warn" : "done"}>{n.state === "WAITING" ? "Still waiting for action" : "Already dealt with"}</Badge></p> : null}
                  {(() => { const a = notificationAction(n.event_type); return a && n.state !== "DONE" ? <Link href={a.href} className="mt-2 inline-block text-sm text-brand-700 underline">{a.label}</Link> : null; })()}
                </div>
                {!n.read_at ? <MarkRead id={n.id} /> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
