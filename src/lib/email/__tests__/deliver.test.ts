import { describe, expect, it } from "vitest";
import { composeMail, deliverPending, type DeliveryDeps, type Mail, type OutboxRow } from "../deliver";

const row = (n: number, over: Partial<OutboxRow> = {}): OutboxRow => ({ id: `id-${n}`, to_email: `user${n}@example.test`, subject: `Subject ${n}`, body: `Body ${n}`, attempts: 1, ...over });
function harness(rows: OutboxRow[], send?: (m: Mail) => Promise<void>) {
  const marks: [string, boolean, string | undefined][] = [], skips: [string, string][] = [], sent: Mail[] = [];
  const deps: DeliveryDeps = {
    claim: async (limit) => rows.slice(0, limit),
    mark: async (id, ok, error) => { marks.push([id, ok, error]); },
    skip: async (id, reason) => { skips.push([id, reason]); },
    transport: { name: "test", send: send ?? (async (m) => { sent.push(m); }) },
    appUrl: "https://okr.example.test/",
  };
  return { deps, marks, skips, sent };
}

describe("composeMail", () => {
  it("is plain text, links to the application and explains why the message was sent", () => {
    const m = composeMail(row(1), "https://okr.example.test/");
    expect(m).toMatchObject({ to: "user1@example.test", subject: "Subject 1" });
    expect(m.text).toContain("Body 1");
    expect(m.text).toContain("https://okr.example.test/notifications");
    expect(m.text).not.toMatch(/<[a-z]/i);
    expect(composeMail(row(1)).text).not.toContain("Open the application");              // no address configured: no link
  });
  it("is signed by 4Core BizOps and names the product 4Core Weekly OKR", () => {
    const text = composeMail(row(1)).text;
    expect(text).toContain("Regards,\n4Core BizOps");
    expect(text).toContain("4Core Weekly OKR.");
    expect(text.indexOf("4Core BizOps")).toBeGreaterThan(text.indexOf("Body 1"));      // the signature follows the message
  });
  it("refuses anything that is not one plain address", () => {
    expect(() => composeMail(row(1, { to_email: "a@b.test\r\nBcc: x@y.test" }))).toThrow();
    expect(() => composeMail(row(1, { to_email: "a@b.test,c@d.test" }))).toThrow();
    expect(() => composeMail(row(1, { to_email: "plainly-not-an-address" }))).toThrow();
  });
  it("cannot be used to inject headers through a subject", () => {
    expect(composeMail(row(1, { subject: "Hello\r\nBcc: attacker@example.test" })).subject).toBe("Hello Bcc: attacker@example.test");
    expect(composeMail(row(1, { subject: "x".repeat(500) })).subject).toHaveLength(200);
  });
});

describe("deliverPending", () => {
  it("sends every claimed row and records each success", async () => {
    const h = harness([row(1), row(2), row(3)]);
    const r = await deliverPending(h.deps);
    expect(r).toMatchObject({ claimed: 3, sent: 3, failed: 0, skipped: 0, transport: "test" });
    expect(h.sent.map((m) => m.to)).toEqual(["user1@example.test", "user2@example.test", "user3@example.test"]);
    expect(h.marks.every(([, ok]) => ok)).toBe(true);
  });
  it("records a failure for that row only and carries on with the rest", async () => {
    const h = harness([row(1), row(2), row(3)], async (m) => { if (m.to.startsWith("user2")) throw new Error("mailbox full"); });
    const r = await deliverPending(h.deps);
    expect(r).toMatchObject({ sent: 2, failed: 1 });
    expect(h.marks).toContainEqual(["id-2", false, "mailbox full"]);
    expect(h.marks.filter(([, ok]) => ok)).toHaveLength(2);
  });
  it("parks mail when no provider is configured instead of retrying forever", async () => {
    const h = harness([row(1), row(2)]);
    const r = await deliverPending({ ...h.deps, transport: null });
    expect(r).toMatchObject({ claimed: 2, sent: 0, skipped: 2, transport: "none" });
    expect(h.skips.map(([id]) => id)).toEqual(["id-1", "id-2"]);
    expect(h.marks).toEqual([]);
  });
  it("asks for no more than the limit and does nothing when there is nothing to do", async () => {
    const h = harness(Array.from({ length: 40 }, (_, i) => row(i)));
    expect((await deliverPending(h.deps, 5)).claimed).toBe(5);
    expect(await deliverPending(harness([]).deps)).toMatchObject({ claimed: 0, sent: 0 });
  });
});
