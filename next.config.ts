import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Fully dynamic, authenticated application: no prerendered/cached shells.
  cacheComponents: false,
  poweredByHeader: false,
  // the container image (Dockerfile) builds a self-contained server; a normal build and `next start` are unchanged
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  // report exports: these load data files / native streams at runtime and must not be bundled
  serverExternalPackages: ["pdfkit", "exceljs"],
  turbopack: { rules: { "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" } } },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // CSP — restrict to same-origin scripts/styles, data URIs, and self; allow charts/fonts from trusted sources
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com",
              "style-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com",
              "img-src 'self' data:",
              "font-src 'self' data:",
              "connect-src 'self'",
              "frame-src 'none'",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
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
