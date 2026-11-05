import net from "node:net";

/**
 * Checks an uploaded file before it is stored. Two layers:
 *   1. Built-in inspection (always on, no service needed): the EICAR test signature, executable code hidden behind an allowed type, PDFs that run script, launch programs or carry
 *      embedded files, Word/Excel files that carry macros, Office zip files that carry macros, executables or embedded objects, and web script hidden inside an image.
 *      This catches the common ways a document is turned into a weapon. It is NOT an antivirus: it cannot recognise unknown malware.
 *   2. ClamAV (when CLAMAV_HOST is set): the file's bytes are streamed to a clamd daemon (INSTREAM) and its verdict is final. When ClamAV is configured but cannot be reached the
 *      upload is refused (fail closed), unless ATTACHMENT_SCAN_REQUIRED=false.
 * Every outcome is recorded with the engine that produced it.
 */
export type ScanResult =
  | { ok: true; engine: "built-in" | "clamav+built-in" }
  | { ok: false; reason: "INFECTED" | "SUSPICIOUS" | "UNAVAILABLE"; detail: string };

const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
const ascii = (s: string) => Buffer.from(s, "latin1");
const has = (b: Buffer, needle: string, utf16 = false) => b.includes(utf16 ? Buffer.from(needle, "utf16le") : ascii(needle));
const hasI = (b: Buffer, needle: string) => b.toString("latin1").toLowerCase().includes(needle.toLowerCase());

const startsWith = (b: Buffer, sig: number[]) => b.length >= sig.length && sig.every((v, i) => b[i] === v);
const EXECUTABLE_MAGIC: [string, number[]][] = [
  ["a Windows program", [0x4d, 0x5a]], ["a Linux program", [0x7f, 0x45, 0x4c, 0x46]], ["a macOS program", [0xfe, 0xed, 0xfa, 0xce]], ["a macOS program", [0xfe, 0xed, 0xfa, 0xcf]],
  ["a macOS program", [0xce, 0xfa, 0xed, 0xfe]], ["a macOS program", [0xcf, 0xfa, 0xed, 0xfe]], ["a Java class", [0xca, 0xfe, 0xba, 0xbe]], ["a script", [0x23, 0x21]],
];

/** PDF names may be written with #xx escapes to hide them (/J#61vaScript): decode before looking. */
const unhashNames = (s: string) => s.replace(/#([0-9a-f]{2})/gi, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));

/** The entry names of a zip file, read from its central directory (compressed data is never searched, so random bytes cannot look like a name). */
export function zipEntryNames(b: Buffer): string[] | null {
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return null;
  const count = b.readUInt16LE(eocd + 10);
  let p = b.readUInt32LE(eocd + 16);
  const names: string[] = [];
  for (let n = 0; n < count && p + 46 <= b.length; n++) {
    if (b.readUInt32LE(p) !== 0x02014b50) return names.length ? names : null;
    const nameLen = b.readUInt16LE(p + 28), extra = b.readUInt16LE(p + 30), comment = b.readUInt16LE(p + 32);
    names.push(b.toString("latin1", p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extra + comment;
  }
  return names;
}

/** The built-in inspection. Pure and fast; returns the first problem found, or null. */
export function inspectUpload(bytes: Uint8Array, mime: string): { reason: "INFECTED" | "SUSPICIOUS"; detail: string } | null {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (has(b, EICAR)) return { reason: "INFECTED", detail: "it contains the standard antivirus test signature (EICAR)" };
  for (const [what, sig] of EXECUTABLE_MAGIC) if (startsWith(b, sig)) return { reason: "SUSPICIOUS", detail: `it is ${what}, not a document` };

  if (mime === "application/pdf") {
    // the PDF's own structure, without the compressed stream bodies (random bytes in those must not look like a name)
    const text = unhashNames(b.toString("latin1").replace(/stream\r?\n[\s\S]*?endstream/g, "stream endstream"));
    for (const tag of ["/JavaScript", "/JS", "/Launch", "/EmbeddedFile", "/RichMedia", "/SubmitForm", "/ImportData"]) {
      if (new RegExp(`${tag.replace("/", "\\/")}(?![A-Za-z])`).test(text)) return { reason: "SUSPICIOUS", detail: `the PDF uses ${tag} (script, a program or an embedded file)` };
    }
  }
  if (mime === "application/msword" || mime === "application/vnd.ms-excel") {
    if (has(b, "_VBA_PROJECT") || has(b, "VBA", true) || has(b, "Macros", true) || hasI(b, "Attribute VB_Name")) return { reason: "SUSPICIOUS", detail: "the file contains macros" };
  }
  if (mime.startsWith("application/vnd.openxmlformats-officedocument")) {
    const names = zipEntryNames(b);
    if (!names) return { reason: "SUSPICIOUS", detail: "the Office file is damaged or is not a real Office file" };
    for (const n of names) {
      const low = n.toLowerCase();
      if (/vbaproject\.bin$|(^|\/)macros?(heets)?\//.test(low)) return { reason: "SUSPICIOUS", detail: "the file contains macros" };
      if (/(^|\/)(embeddings|activex)\//.test(low) || /oleobject/.test(low) || /\.(exe|dll|js|vbs|bat|cmd|ps1|scr|jar|com|msi|lnk)$/.test(low)) return { reason: "SUSPICIOUS", detail: `the file contains an embedded item (${n})` };
    }
  }
  if (mime.startsWith("image/")) {
    if (hasI(b, "<script") || hasI(b, "<?php") || hasI(b, "<html")) return { reason: "SUSPICIOUS", detail: "the image has web script hidden inside it" };
  }
  return null;
}

/** One verdict from a ClamAV daemon (clamd INSTREAM). Resolves "OK", "FOUND: <name>", or throws if the daemon cannot be used. */
export function clamdScan(bytes: Uint8Array, host: string, port: number, timeoutMs: number): Promise<{ clean: boolean; signature?: string }> {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host, port });
    let out = "";
    const fail = (e: Error) => { sock.destroy(); reject(e); };
    sock.setTimeout(timeoutMs, () => fail(new Error("the scanner did not answer in time")));
    sock.on("error", fail);
    sock.on("data", (d) => { out += d.toString("latin1"); });
    sock.on("end", () => {
      const reply = out.replace(/\0/g, "").trim();
      if (/OK$/.test(reply)) return resolve({ clean: true });
      const m = /stream:\s*(.+?)\s+FOUND$/.exec(reply);
      if (m) return resolve({ clean: false, signature: m[1] });
      reject(new Error(`unexpected scanner reply: ${reply.slice(0, 80)}`));
    });
    sock.on("connect", () => {
      sock.write("zINSTREAM\0");
      const CHUNK = 64 * 1024;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        const part = Buffer.from(bytes.subarray(i, i + CHUNK));
        const len = Buffer.alloc(4);
        len.writeUInt32BE(part.length);
        sock.write(len); sock.write(part);
      }
      sock.write(Buffer.alloc(4));            // a zero-length chunk ends the stream
    });
  });
}

export interface ScanConfig { clamHost?: string; clamPort?: number; timeoutMs?: number; required?: boolean }
export const scanConfigFromEnv = (): ScanConfig => ({
  clamHost: process.env.CLAMAV_HOST || undefined, clamPort: Number(process.env.CLAMAV_PORT ?? 3310) || 3310,
  timeoutMs: Number(process.env.CLAMAV_TIMEOUT_MS ?? 20000) || 20000, required: process.env.ATTACHMENT_SCAN_REQUIRED !== "false",
});

export async function scanUpload(bytes: Uint8Array, mime: string, cfg: ScanConfig = scanConfigFromEnv()): Promise<ScanResult> {
  const found = inspectUpload(bytes, mime);
  if (found) return { ok: false, reason: found.reason, detail: found.detail };
  if (!cfg.clamHost) return { ok: true, engine: "built-in" };
  try {
    const v = await clamdScan(bytes, cfg.clamHost, cfg.clamPort ?? 3310, cfg.timeoutMs ?? 20000);
    if (!v.clean) return { ok: false, reason: "INFECTED", detail: `the antivirus scanner found ${v.signature ?? "malware"}` };
    return { ok: true, engine: "clamav+built-in" };
  } catch (e) {
    if (cfg.required === false) return { ok: true, engine: "built-in" };
    return { ok: false, reason: "UNAVAILABLE", detail: e instanceof Error ? e.message : "the scanner could not be used" };
  }
}
