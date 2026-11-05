import net from "node:net";
import { describe, expect, it } from "vitest";
import { inspectUpload, scanUpload, zipEntryNames } from "../attachment-scan";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

/** A minimal zip (stored entries) with a real central directory, enough for the name reader. */
function zip(entries: Record<string, string | Buffer>): Buffer {
  const locals: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of Object.entries(entries)) {
    const body = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const n = Buffer.from(name, "latin1");
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(body.length, 22); lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(body.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, n, body); central.push(ch, n);
    offset += 30 + n.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const randomBytes = (n: number) => { const b = Buffer.alloc(n); for (let i = 0; i < n; i++) b[i] = (i * 2654435761) >>> 24; return b; };

describe("built-in upload inspection", () => {
  it("refuses the antivirus test file wherever it hides", () => {
    expect(inspectUpload(Buffer.from(EICAR), "text/plain")?.reason).toBe("INFECTED");
    expect(inspectUpload(Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from(EICAR)]), "application/pdf")?.reason).toBe("INFECTED");
  });
  it("refuses a program or script wearing an allowed type", () => {
    expect(inspectUpload(Buffer.from([0x4d, 0x5a, 0x90, 0x00, 1, 2, 3]), "application/pdf")?.detail).toContain("Windows program");
    expect(inspectUpload(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1]), "image/png")?.detail).toContain("Linux program");
    expect(inspectUpload(Buffer.from("#!/bin/sh\nrm -rf /"), "text/plain")?.detail).toContain("script");
  });
  it("refuses a PDF that runs script or launches programs, also when the names are disguised", () => {
    for (const body of ["/Type /Action /S /JavaScript /JS (app.alert(1))", "/OpenAction << /S /Launch /F (cmd.exe) >>", "/J#61vaScript", "/EmbeddedFile"]) {
      expect(inspectUpload(Buffer.from(`%PDF-1.7\n1 0 obj\n<< ${body} >>\nendobj\n`), "application/pdf"), body).not.toBeNull();
    }
  });
  it("accepts an ordinary PDF, and is not fooled by random bytes inside a compressed stream", () => {
    const stream = Buffer.concat([Buffer.from("/JS "), randomBytes(5000), Buffer.from(" /JavaScript ")]);
    const pdf = Buffer.concat([Buffer.from("%PDF-1.7\n1 0 obj\n<< /Length 5000 >>\nstream\n"), stream, Buffer.from("\nendstream\nendobj\n%%EOF")]);
    expect(inspectUpload(pdf, "application/pdf")).toBeNull();
  });
  it("refuses Office files with macros, embedded objects or programs; accepts a plain one", () => {
    expect(inspectUpload(zip({ "[Content_Types].xml": "x", "word/document.xml": "x", "word/vbaProject.bin": "x" }), DOCX)?.detail).toBe("the file contains macros");
    expect(inspectUpload(zip({ "[Content_Types].xml": "x", "xl/macrosheets/sheet1.xml": "x" }), XLSX)?.detail).toBe("the file contains macros");
    expect(inspectUpload(zip({ "[Content_Types].xml": "x", "word/embeddings/oleObject1.bin": "x" }), DOCX)?.reason).toBe("SUSPICIOUS");
    expect(inspectUpload(zip({ "[Content_Types].xml": "x", "word/payload.exe": "x" }), DOCX)?.reason).toBe("SUSPICIOUS");
    expect(inspectUpload(zip({ "[Content_Types].xml": "x", "word/document.xml": "x", "docProps/app.xml": "x", "word/media/image1.png": randomBytes(4000) }), DOCX)).toBeNull();
    expect(inspectUpload(Buffer.from("PK\x03\x04 not really a zip"), DOCX)?.detail).toContain("damaged");
  });
  it("reads entry names from the central directory only", () => {
    expect(zipEntryNames(zip({ "a.txt": "x", "dir/b.xml": "y" }))).toEqual(["a.txt", "dir/b.xml"]);
    expect(zipEntryNames(Buffer.from("nothing"))).toBeNull();
  });
  it("refuses legacy Office files with macros", () => {
    const ole = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(200), Buffer.from("VBA", "utf16le"), Buffer.alloc(50)]);
    expect(inspectUpload(ole, "application/msword")?.detail).toBe("the file contains macros");
  });
  it("refuses script hidden inside an image, but not the same words in a text note", () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("<script>alert(1)</script>")]);
    expect(inspectUpload(png, "image/png")?.reason).toBe("SUSPICIOUS");
    expect(inspectUpload(Buffer.from("we should remove the <script> tag from the page"), "text/plain")).toBeNull();
  });
});

/** A fake clamd: answers INSTREAM like the real one and records what it was sent. */
function fakeClamd(reply: string) {
  const got: Buffer[] = [];
  const server = net.createServer((sock) => {
    sock.on("data", (d) => {
      got.push(d);
      const all = Buffer.concat(got);
      if (all.subarray(all.length - 4).equals(Buffer.alloc(4))) { sock.end(reply); }
    });
  });
  return new Promise<{ port: number; got: Buffer[]; close: () => void }>((resolve) => server.listen(0, "127.0.0.1", () => resolve({ port: (server.address() as net.AddressInfo).port, got, close: () => server.close() })));
}

describe("scanUpload with and without ClamAV", () => {
  const clean = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF");
  it("uses the built-in inspection alone when no scanner is configured", async () => {
    expect(await scanUpload(clean, "application/pdf", {})).toEqual({ ok: true, engine: "built-in" });
    expect(await scanUpload(Buffer.from(EICAR), "text/plain", {})).toMatchObject({ ok: false, reason: "INFECTED" });
  });
  it("streams the file to clamd in the INSTREAM protocol and accepts a clean verdict", async () => {
    const c = await fakeClamd("stream: OK\0");
    const r = await scanUpload(clean, "application/pdf", { clamHost: "127.0.0.1", clamPort: c.port, timeoutMs: 3000 });
    const sent = Buffer.concat(c.got);
    c.close();
    expect(r).toEqual({ ok: true, engine: "clamav+built-in" });
    expect(sent.subarray(0, 10).toString()).toBe("zINSTREAM\0");
    expect(sent.readUInt32BE(10)).toBe(clean.length);
    expect(sent.subarray(14, 14 + clean.length).equals(clean)).toBe(true);
  });
  it("refuses a file the scanner reports as infected", async () => {
    const c = await fakeClamd("stream: Win.Test.Malware-1 FOUND\0");
    const r = await scanUpload(clean, "application/pdf", { clamHost: "127.0.0.1", clamPort: c.port, timeoutMs: 3000 });
    c.close();
    expect(r).toMatchObject({ ok: false, reason: "INFECTED" });
    expect((r as { detail: string }).detail).toContain("Win.Test.Malware-1");
  });
  it("fails closed when the configured scanner cannot be reached, unless scanning is optional", async () => {
    const down = { clamHost: "127.0.0.1", clamPort: 1, timeoutMs: 1000 };
    expect(await scanUpload(clean, "application/pdf", down)).toMatchObject({ ok: false, reason: "UNAVAILABLE" });
    expect(await scanUpload(clean, "application/pdf", { ...down, required: false })).toEqual({ ok: true, engine: "built-in" });
  });
  it("never asks the scanner about a file the built-in inspection already refused", async () => {
    const c = await fakeClamd("stream: OK\0");
    const r = await scanUpload(Buffer.from(EICAR), "text/plain", { clamHost: "127.0.0.1", clamPort: c.port, timeoutMs: 1000 });
    c.close();
    expect(r).toMatchObject({ ok: false, reason: "INFECTED" });
    expect(c.got).toHaveLength(0);
  });
});
