import { z } from "zod";

const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  /** Keys the hash of emailed one-time passcodes, so a leaked table cannot be attacked offline without it. */
  MFA_EMAIL_PEPPER: z.string().min(32),
  JOBS_SECRET: z.string().min(16),
  /** The secret being retired: accepted alongside JOBS_SECRET while the scheduler is switched over, then removed. */
  JOBS_SECRET_PREVIOUS: z.string().min(16).optional(),
});

let cached: z.infer<typeof schema> | undefined;

/** Server-side environment, validated once. Never import this from client components. */
export function env() {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error("Invalid server environment: " + parsed.error.issues.map((i) => i.path.join(".")).join(", "));
    }
    cached = parsed.data;
  }
  return cached;
}
