import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { getBranding } from "@/lib/data/branding";
import { getSite } from "@/lib/data/site";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

// The title, wording and which links appear come from Administration → Landing & sign-in.
export default async function LoginPage() {
  const [{ config }, brand] = await Promise.all([getSite(), getBranding()]);
  const f = config.login.form;
  return (
    <div className="w-full max-w-sm">
      <div className="mb-8">
        {brand.logoUrl
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={brand.logoUrl} alt="" className="mb-4 h-12 w-12 rounded-xl object-contain lg:hidden" />
          : <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-700 text-lg font-bold text-white lg:hidden" aria-hidden>{brand.shortName}</div>}
        <h1 className="text-3xl font-semibold tracking-tight">{f.title}</h1>
        {f.subtitle ? <p className="mt-2 text-sm text-muted">{f.subtitle}</p> : null}
      </div>
      <Suspense>
        <LoginForm showForgot={f.showForgot} forgotLabel={f.forgotLabel} />
      </Suspense>
      {f.footnote ? <p className="mt-6 text-xs text-muted">{f.footnote}</p> : null}
      {f.showBackLink ? <p className="mt-4 text-sm"><Link href="/" className="text-brand-700 underline">{f.backLabel}</Link></p> : null}
    </div>
  );
}
