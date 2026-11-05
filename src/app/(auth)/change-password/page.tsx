import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/actor";
import { ChangeForm } from "./change-form";

export const metadata: Metadata = { title: "Choose your password" };

export default async function ChangePasswordPage() {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (!actor.mustChangePassword) redirect("/dashboard");
  return (
    <div className="w-full max-w-sm">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Choose your own password</h1>
        <p className="mt-1 text-sm text-muted">The password you signed in with was set for you. Replace it to continue: at least 12 characters with upper and lower case letters and a digit.</p>
      </div>
      <ChangeForm />
    </div>
  );
}
