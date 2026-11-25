import { api } from "@/lib/api/handler";
import { listRetirementExecutives } from "@/lib/data/bu-goal-retirements";

/** The executives a BU Lead may choose to approve a goal retirement: name and role (the database decides who qualifies). */
export const GET = api({}, async () => listRetirementExecutives());
