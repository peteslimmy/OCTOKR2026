/**
 * Checks that a file's first bytes really are the type it claims to be. The browser supplies both the file and its MIME type, so the type
 * on its own proves nothing (audit finding F-008). This does not scan for malware; it stops a script or executable being stored as a PDF.
 */
const startsWith = (b: Uint8Array, sig: number[], at = 0) => b.length >= at + sig.length && sig.every((v, i) => b[at + i] === v);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

const PDF = ascii("%PDF-");
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const GIF87 = ascii("GIF87a");
const GIF89 = ascii("GIF89a");
const RIFF = ascii("RIFF");
const WEBP = ascii("WEBP");
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];   // legacy .doc / .xls
const ZIP = [0x50, 0x4b, 0x03, 0x04];                           // .docx / .xlsx are zip containers

export function contentMatchesMime(bytes: Uint8Array, mime: string): boolean {
  switch (mime) {
    case "application/pdf": return startsWith(bytes, PDF);
    case "image/png": return startsWith(bytes, PNG);
    case "image/jpeg": return startsWith(bytes, JPEG);
    case "image/gif": return startsWith(bytes, GIF87) || startsWith(bytes, GIF89);
    case "image/webp": return startsWith(bytes, RIFF) && startsWith(bytes, WEBP, 8);
    case "application/msword":
    case "application/vnd.ms-excel": return startsWith(bytes, OLE);
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": return startsWith(bytes, ZIP);
    case "text/plain": {
      const head = bytes.subarray(0, 8192);
      if (head.includes(0)) return false;                       // binary data is not text
      try { new TextDecoder("utf-8", { fatal: true }).decode(head); return true; } catch { return false; }
    }
    default: return false;                                       // a type that is not on the allow-list never matches
  }
}
