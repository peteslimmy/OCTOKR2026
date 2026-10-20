import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { simpleParser, type ParsedMail } from "mailparser";
import { SMTPServer } from "smtp-server";
import { afterEach, beforeAll, afterAll, describe, expect, it } from "vitest";
import { composeMail, deliverPending, type OutboxRow } from "../deliver";
import { configuredTransport } from "../transport";

// A real SMTP conversation over a socket, against an in-process server: proves the SMTP transport, not just the code around it.
let server: SMTPServer; let port = 0; const received: ParsedMail[] = [];
beforeAll(async () => {
  server = new SMTPServer({
    authOptional: true, disabledCommands: ["STARTTLS", "AUTH"], logger: false,
    onData(stream, _session, cb) { simpleParser(stream).then((m) => { received.push(m); cb(); }, cb); },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  port = (server.server.address() as { port: number }).port;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });
const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; received.length = 0; });
const row = (over: Partial<OutboxRow> = {}): OutboxRow => ({ id: "row-1", to_email: "person@example.test", subject: "Weekly report due in about 6 hours", body: "Engineering has not submitted its report.", attempts: 1, ...over });

describe("configuredTransport", () => {
  it("is nothing unless an operator configures a provider", () => {
    delete process.env.EMAIL_TRANSPORT;
    expect(configuredTransport()).toBeNull();
    process.env.EMAIL_TRANSPORT = "smtp"; delete process.env.SMTP_URL;
    expect(configuredTransport()).toBeNull();                                              // named but not configured
    process.env.EMAIL_TRANSPORT = "file"; delete process.env.EMAIL_FILE_DIR;
    expect(configuredTransport()).toBeNull();
    process.env.EMAIL_TRANSPORT = "carrier-pigeon";
    expect(configuredTransport()).toBeNull();
  });

  it("sends real mail over SMTP with the right sender, recipient, subject and plain-text body", async () => {
    process.env.EMAIL_TRANSPORT = "smtp"; process.env.SMTP_URL = `smtp://127.0.0.1:${port}`; process.env.EMAIL_FROM = "4CORE-OKR <no-reply@example.test>";
    const t = configuredTransport()!;
    expect(t.name).toBe("smtp");
    await t.send(composeMail(row(), "https://okr.example.test"));
    expect(received).toHaveLength(1);
    const m = received[0];
    expect(m.from?.value[0].address).toBe("no-reply@example.test");
    expect(m.to).toMatchObject({ value: [{ address: "person@example.test" }] });
    expect(m.subject).toBe("Weekly report due in about 6 hours");
    expect(m.text).toContain("Engineering has not submitted its report.");
    expect(m.text).toContain("https://okr.example.test/notifications");
    expect(m.html).toBeFalsy();                                                           // plain text only
  });

  it("cannot be made to add recipients or headers through a subject or an address", async () => {
    process.env.EMAIL_TRANSPORT = "smtp"; process.env.SMTP_URL = `smtp://127.0.0.1:${port}`;
    const t = configuredTransport()!;
    await t.send(composeMail(row({ subject: "Hello\r\nBcc: attacker@example.test" })));
    expect(received[0].subject).toBe("Hello Bcc: attacker@example.test");
    expect(received[0].headers.get("bcc")).toBeUndefined();
    for (const bad of ["a@example.test\r\nRCPT TO:<b@example.test>", "a@example.test, b@example.test", "a b@example.test", "<a@example.test>", "nobody"]) {
      expect(() => composeMail(row({ to_email: bad })), bad).toThrow(/recipient/);                       // a malformed address is refused, never split
    }
    expect(received).toHaveLength(1);
  });

  it("reports a server that is not there as a failure, which the delivery loop records and retries", async () => {
    process.env.EMAIL_TRANSPORT = "smtp"; process.env.SMTP_URL = "smtp://127.0.0.1:1";   // nothing listens on port 1
    const marks: [string, boolean, string | undefined][] = [];
    const out = await deliverPending({ claim: async () => [row()], mark: async (id, ok, e) => { marks.push([id, ok, e]); }, skip: async () => undefined, transport: configuredTransport() });
    expect(out).toMatchObject({ claimed: 1, sent: 0, failed: 1, transport: "smtp" });
    expect(marks[0][1]).toBe(false);
    expect(marks[0][2]).toMatch(/ECONNREFUSED|connect/i);
  });

  it("writes one JSON file per mail for the development transport", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "okr-mail-"));
    process.env.EMAIL_TRANSPORT = "file"; process.env.EMAIL_FILE_DIR = dir;
    const t = configuredTransport()!;
    await t.send(composeMail(row()));
    await t.send(composeMail(row({ to_email: "other@example.test" })));
    const files = await readdir(dir);
    expect(files).toHaveLength(2);
    expect(JSON.parse(await readFile(path.join(dir, files[0]), "utf8"))).toMatchObject({ subject: "Weekly report due in about 6 hours" });
  });
});
