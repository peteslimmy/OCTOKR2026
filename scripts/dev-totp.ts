/** LOCAL DEVELOPMENT ONLY: prints the current authenticator code of a seeded elevated user.  npm run dev:totp -- admin@4core.local */
import { existsSync, readFileSync } from "node:fs";
import { DEV_MFA_FILE, totp } from "./totp";

const email = process.argv[2];
if (!email || !existsSync(DEV_MFA_FILE)) {
  console.error(`usage: dev-totp <email>   (needs ${DEV_MFA_FILE}, created by npm run dev:seed)`);
  process.exit(1);
}
const secrets = JSON.parse(readFileSync(DEV_MFA_FILE, "utf8")) as Record<string, string>;
if (!secrets[email]) {
  console.error(`no authenticator secret recorded for ${email}`);
  process.exit(1);
}
console.log(totp(secrets[email]));
