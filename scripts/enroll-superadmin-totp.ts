import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { DEV_MFA_FILE, totp } from "./totp";

config({ path: ".env.local" });

const EMAIL = "peteslimmy@gmail.com";
const PASSWORD = "Xodmansky%12";

async function main() {
  console.log(`Starting MFA enrollment for ${EMAIL}...`);

  // Sign in as the user
  const userClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } }
  );

  const { data: signedIn, error: signInError } = await userClient.auth.signInWithPassword({
    email: EMAIL,
    password: PASSWORD,
  });
  if (signInError || !signedIn.user) {
    throw new Error(`Sign in failed: ${signInError?.message}`);
  }
  console.log("Signed in.");

  // Enroll TOTP
  const enrol = await userClient.auth.mfa.enroll({ factorType: "totp", issuer: "4CORE-OKR (dev)" });
  if (enrol.error || !enrol.data) {
    throw new Error(`MFA enroll failed: ${enrol.error?.message}`);
  }
  console.log("MFA factor enrolled.");

  // Verify TOTP
  const verify = await userClient.auth.mfa.challengeAndVerify({
    factorId: enrol.data.id,
    code: totp(enrol.data.totp.secret),
  });
  if (verify.error) {
    throw new Error(`MFA verify failed: ${verify.error.message}`);
  }
  console.log("MFA factor verified.");

  // Store secret
  const secrets: Record<string, string> = existsSync(DEV_MFA_FILE) ? JSON.parse(readFileSync(DEV_MFA_FILE, "utf8")) : {};
  secrets[EMAIL] = enrol.data.totp.secret;
  writeFileSync(DEV_MFA_FILE, JSON.stringify(secrets, null, 2));
  console.log(`Secret stored in ${DEV_MFA_FILE}`);

  await userClient.auth.signOut();
  console.log("\n✅ TOTP enrolled and verified!");
  console.log(`Run \`npm run dev:totp -- ${EMAIL}\` to get codes in the future.`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});