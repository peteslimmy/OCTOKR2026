/**
 * Go-live check for the email provider (docs/27 section 5). It does what the application will do, once, and tells you what is missing:
 *   1. connects to SMTP_URL and logs in (nodemailer verify),
 *   2. looks up the sender domain's SPF and DMARC records (DKIM cannot be checked without knowing the provider's selector: confirm it in the provider's console),
 *   3. sends one plain-text test message to the address you give.
 *
 *   SMTP_URL=smtps://user:pass@host:465 EMAIL_FROM="4CORE-OKR <no-reply@your-domain>" EMAIL_CHECK_TO=you@your-domain npm run email:check
 *
 * Nothing is stored. The SMTP password is read from the environment and never printed.
 */
import { config } from "dotenv";
import { resolveTxt } from "node:dns/promises";
import nodemailer from "nodemailer";

config({ path: ".env.local" });

const url = process.env.SMTP_URL;
const from = process.env.EMAIL_FROM || "";
const to = process.env.EMAIL_CHECK_TO || "";
if (!url || !from || !to) {
  console.error("Set SMTP_URL, EMAIL_FROM and EMAIL_CHECK_TO (the address that should receive the test message).");
  process.exit(1);
}
const domain = (from.match(/<([^>]+)>/)?.[1] ?? from).split("@")[1]?.trim();
const txt = async (name: string) => (await resolveTxt(name).catch(() => [])).map((r) => r.join(""));

async function main() {
  let problems = 0;
  const t = nodemailer.createTransport(url!);
  try { await t.verify(); console.log("OK    connected to the SMTP server and signed in"); }
  catch (e) { console.error(`FAIL  could not connect or sign in: ${(e as Error).message}`); process.exit(2); }

  if (domain) {
    const spf = (await txt(domain)).find((r) => r.startsWith("v=spf1"));
    console.log(spf ? `OK    SPF record found for ${domain}` : `WARN  no SPF record for ${domain}: mail from this domain is likely to be filtered as spam`);
    if (!spf) problems++;
    const dmarc = (await txt(`_dmarc.${domain}`)).find((r) => r.startsWith("v=DMARC1"));
    console.log(dmarc ? `OK    DMARC record found for ${domain}` : `WARN  no DMARC record for ${domain}: some receivers will distrust it`);
    if (!dmarc) problems++;
    console.log("NOTE  DKIM: confirm in the provider's console that the domain is verified and signing (it needs the provider's selector, which this check cannot know).");
  } else { console.log("WARN  EMAIL_FROM has no domain to check"); problems++; }

  try {
    const r = await t.sendMail({ from, to, subject: "4CORE-OKR email check", text: "This message was sent by `npm run email:check` to confirm that 4CORE-OKR can send email. Nothing else is needed." });
    console.log(`OK    test message accepted by the server (id ${r.messageId})`);
  } catch (e) { console.error(`FAIL  the server refused the test message: ${(e as Error).message}`); process.exit(3); }
  console.log(problems ? `\nDone, with ${problems} warning(s). Check the inbox (and the spam folder) of ${to}.` : `\nDone. Check the inbox of ${to}.`);
}
main().catch((e) => { console.error((e as Error).message); process.exit(1); });
