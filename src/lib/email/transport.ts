import "server-only";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import fetch from "node-fetch";
import nodemailer from "nodemailer";
import type { Mail, Transport } from "./deliver";

/**
 * Chooses how mail leaves the application, from the environment (the provider is an open decision, ADR-054 #8):
 *   EMAIL_TRANSPORT=smtp  + SMTP_URL (smtp://user:pass@host:587 or smtps://...)  + EMAIL_FROM   production
 *   EMAIL_TRANSPORT=resend + RESEND_API_KEY                                                         production
 *   EMAIL_TRANSPORT=file  + EMAIL_FILE_DIR                                                        development and tests only (writes mail to disk): one .json file per mail
 *   anything else                                                                                  no provider: mail waits, then expires
 */
export function configuredTransport(): Transport | null {
  const kind = process.env.EMAIL_TRANSPORT;
  const from = process.env.EMAIL_FROM || "4Core Weekly OKR <no-reply@localhost>";
  if (kind === "smtp" && process.env.SMTP_URL) {
    const t = nodemailer.createTransport(process.env.SMTP_URL);
    return { name: "smtp", send: async (m: Mail) => { await t.sendMail({ from, to: m.to, subject: m.subject, text: m.text, ...(m.html ? { html: m.html } : {}) }); } };
  }
  if (kind === "resend" && process.env.RESEND_API_KEY) {
    return {
      name: "resend",
      send: async (m: Mail) => {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from,
            to: m.to,
            subject: m.subject,
            text: m.text,
            ...(m.html ? { html: m.html } : {}),
          }),
        });
        if (!res.ok) {
          const txt = await res.text();
          throw new Error(`Resend API error ${res.status}: ${txt}`);
        }
        // Response is consumed but not returned (void)
      },
    };
  }
  if (kind === "file" && process.env.EMAIL_FILE_DIR) {
    const dir = path.resolve(process.env.EMAIL_FILE_DIR);
    return {
      name: "file",
      send: async (m: Mail) => { await mkdir(dir, { recursive: true }); await writeFile(path.join(dir, `${Date.now()}-${randomUUID().slice(0, 8)}.json`), JSON.stringify({ from, ...m }, null, 2)); },
    };
  }
  return null;
}
