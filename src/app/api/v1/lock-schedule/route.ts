import { api } from "@/lib/api/handler";
import { getLockSchedule } from "@/lib/data/config";

/** The lock schedule in force, its history and the first week a change would apply to. Changing it is a request: POST /config-changes with topic LOCK_SCHEDULE. */
export const GET = api({}, async () => getLockSchedule());
