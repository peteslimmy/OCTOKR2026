/**
 * Next.js calls register() once when the server starts. Tracing is off unless an OTLP endpoint is configured
 * (OTEL_EXPORTER_OTLP_ENDPOINT or OTEL_EXPORTER_OTLP_TRACES_ENDPOINT), so local development and tests are unaffected.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT && !process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT) return;
  await import("./instrumentation.node");
}
