import { api } from "@/lib/api/handler";
import { listNotifications, unreadCount } from "@/lib/data";

export const GET = api({}, async () => ({ items: await listNotifications(), unread: await unreadCount() }));
