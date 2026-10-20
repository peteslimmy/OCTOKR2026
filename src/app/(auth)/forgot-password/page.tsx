import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ForgotForm } from "./forgot-form";

export const metadata: Metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
        <p className="mt-1 text-sm text-muted">We will email you a one-time link.</p>
      </div>
      <Suspense>
        <ForgotForm />
      </Suspense>
      <p className="mt-4 text-center text-sm"><Link href="/login" className="text-brand-700 underline">Back to sign in</Link></p>
    </div>
  );
}
