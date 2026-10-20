import { api } from "@/lib/api/handler";
import { activeWeeks } from "@/lib/data";

export const GET = api({}, async () => activeWeeks());
