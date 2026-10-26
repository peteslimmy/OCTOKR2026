import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // tests build and serve their own copy (NEXT_DIST_DIR=.next-test, set by scripts/test-stack.mjs) so they never disturb a running dev server
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // Fully dynamic, authenticated application: no prerendered/cached shells.
  cacheComponents: false,
  poweredByHeader: false,
  // the container image (Dockerfile) builds a self-contained server; a normal build and `next start` are unchanged
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  // report exports: these load data files / native streams at runtime and must not be bundled
  serverExternalPackages: ["pdfkit", "exceljs", "@opentelemetry/sdk-node", "@opentelemetry/auto-instrumentations-node", "systeminformation"],   // the tracing packages are loaded at run time, not bundled (the bundler cannot process systeminformation on Windows)
  turbopack: { rules: { "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" } } },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // The Content-Security-Policy is set per request, with a nonce, in src/proxy.ts (ADR-052); it is deliberately not repeated here.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
        ],
      },
    ];
  },
};

export default nextConfig;
