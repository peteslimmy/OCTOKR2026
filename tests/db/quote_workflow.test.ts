import { describe, expect, it } from "vitest";
import { seedStrategy, weekId, withTx, type Ctx } from "./helpers";

async function world(c: Ctx) {
  const bu = await c.bu("ALPHA");
  const admin = await c.user(["ADMIN"], bu, "admin");
  const hr = await c.user(["HR"], bu, "hr");
  const director = await c.user(["DIRECTOR"], bu, "director");
  const lead = await c.user(["BU_LEAD"], bu, "lead");
  await seedStrategy(c, admin);
  const wk = await weekId(c);
  const quote = await c.rpc<string>("record_weekly_quote", hr, wk, bu, "Ada Lovelace", "Ship small, ship often.");
  const status = async () => (await c.q<{ status: string }>("select status from weekly_quotes where id = $1", [quote]))[0].status;
  return { bu, admin, hr, director, lead, wk, quote, status };
}

describe("quote workflow (ADR-084)", () => {
  it("runs draft, submitted, approved, published, archived with a second person approving", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      expect(await w.status()).toBe("draft");
      await c.expectError("PERMISSION_DENIED", () => c.rpc("submit_quote", w.lead, w.quote));
      await c.rpc("submit_quote", w.hr, w.quote);
      expect(await w.status()).toBe("submitted");
      const note = await c.q("select user_id from notifications where event_type = 'QUOTE_SUBMITTED' and entity_id = $1", [w.quote]);
      expect(note.length).toBeGreaterThan(0);
      await c.expectError("PERMISSION_DENIED", () => c.rpc("approve_quote", w.hr, w.quote));
      await c.expectError("INVALID_STATE_TRANSITION", () => c.rpc("publish_quote", w.director, w.quote));
      await c.rpc("approve_quote", w.director, w.quote);
      await c.rpc("publish_quote", w.director, w.quote);
      expect(await w.status()).toBe("published");
      const shown = await c.asUser(w.lead, () => c.rpc<{ quote: string; speaker_name: string }>("read_published_quote", w.wk));
      expect(shown).toMatchObject({ quote: "Ship small, ship often.", speaker_name: "Ada Lovelace" });
      await c.rpc("archive_quote", w.director, w.quote);
      expect(await w.status()).toBe("archived");
      expect(await c.asUser(w.lead, () => c.rpc("read_published_quote", w.wk))).toBeNull();
      const actions = (await c.q<{ action: string }>("select action from audit_logs where entity_id = $1 and action like 'QUOTE_%' order by seq", [w.quote])).map((a) => a.action);
      expect(actions).toEqual(["QUOTE_SUBMITTED", "QUOTE_APPROVED", "QUOTE_PUBLISHED", "QUOTE_ARCHIVED"]);
    });
  });

  it("the person who recorded or submitted a quote cannot approve it", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      // the admin holds both quote.record and quote.approve
      const adminQuote = await c.rpc<string>("record_weekly_quote", w.admin, (await c.q<{ id: string }>("select id from reporting_weeks order by week_start_at offset 1 limit 1"))[0].id, w.bu, "Self", "Mine");
      await c.rpc("submit_quote", w.admin, adminQuote);
      await c.expectError("QUOTE_SELF_APPROVAL", () => c.rpc("approve_quote", w.admin, adminQuote));
      // HR recorded the first quote; another HR submitting does not let the recorder approve either
      await c.rpc("submit_quote", w.admin, w.quote);
      await c.expectError("QUOTE_SELF_APPROVAL", () => c.rpc("approve_quote", w.admin, w.quote));
      await c.rpc("approve_quote", w.director, w.quote);
    });
  });

  it("an unpublished quote is invisible to the banner and the words can never be edited", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      expect(await c.asUser(w.lead, () => c.rpc("read_published_quote", w.wk))).toBeNull();
      await c.expectError("IMMUTABLE_RECORD", () => c.q("update weekly_quotes set quote = 'changed' where id = $1", [w.quote]));
      await c.expectError("IMMUTABLE_RECORD", () => c.q("delete from weekly_quotes where id = $1", [w.quote]));
      await c.expectError("INVALID_STATE_TRANSITION", () => c.q("update weekly_quotes set status = 'published' where id = $1", [w.quote]));
    });
  });
});
