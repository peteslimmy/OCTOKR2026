import { describe, expect, it } from "vitest";
import { ALLOWED_MIME_TYPES } from "../evidence";
import { contentMatchesMime } from "../evidence-signature";

const bytes = (...v: number[]) => new Uint8Array([...v, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20]);
const text = (s: string) => new TextEncoder().encode(s);

describe("evidence file content must match the claimed type (F-008)", () => {
  it("accepts a real file signature for each allowed type", () => {
    expect(contentMatchesMime(text("%PDF-1.7\n"), "application/pdf")).toBe(true);
    expect(contentMatchesMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), "image/png")).toBe(true);
    expect(contentMatchesMime(bytes(0xff, 0xd8, 0xff, 0xe0), "image/jpeg")).toBe(true);
    expect(contentMatchesMime(text("GIF89a......"), "image/gif")).toBe(true);
    expect(contentMatchesMime(text("RIFF\0\0\0\0WEBPVP8 "), "image/webp")).toBe(true);
    expect(contentMatchesMime(bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1), "application/msword")).toBe(true);
    expect(contentMatchesMime(bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1), "application/vnd.ms-excel")).toBe(true);
    const docx = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const xlsx = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    expect(contentMatchesMime(bytes(0x50, 0x4b, 0x03, 0x04), docx)).toBe(true);
    expect(contentMatchesMime(bytes(0x50, 0x4b, 0x03, 0x04), xlsx)).toBe(true);
    expect(contentMatchesMime(text("Plain notes, with accents: é ñ."), "text/plain")).toBe(true);
  });

  it("rejects a script, an executable or HTML dressed up as an allowed type", () => {
    expect(contentMatchesMime(text("<script>alert(1)</script>"), "application/pdf")).toBe(false);
    expect(contentMatchesMime(text("<html><body>x</body></html>"), "image/png")).toBe(false);
    expect(contentMatchesMime(bytes(0x4d, 0x5a, 0x90, 0x00), "image/jpeg")).toBe(false);          // Windows executable
    expect(contentMatchesMime(bytes(0x7f, 0x45, 0x4c, 0x46), "application/vnd.ms-excel")).toBe(false);   // Linux executable
    expect(contentMatchesMime(text("%PDF-1.7"), "image/png")).toBe(false);                         // a real PDF claiming to be a PNG
  });

  it("rejects binary data claimed as text, truncated files and unknown types", () => {
    expect(contentMatchesMime(bytes(0x4d, 0x5a, 0x00, 0x00), "text/plain")).toBe(false);
    expect(contentMatchesMime(new Uint8Array([0xff, 0xfe, 0xfd]), "text/plain")).toBe(false);      // not valid UTF-8
    expect(contentMatchesMime(new Uint8Array([0x25, 0x50]), "application/pdf")).toBe(false);
    expect(contentMatchesMime(new Uint8Array(), "image/png")).toBe(false);
    expect(contentMatchesMime(text("%PDF-1.7"), "application/x-msdownload")).toBe(false);
  });

  it("has a rule for every type on the upload allow-list", () => {
    for (const mime of ALLOWED_MIME_TYPES) {
      // a deliberately wrong payload must be rejected for each: no allowed type falls through to "accept anything"
      expect(contentMatchesMime(text("\u0000\u0001\u0002\u0003MZ-not-a-real-file"), mime), mime).toBe(false);
    }
  });
});
