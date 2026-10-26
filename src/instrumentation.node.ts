import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";

// The exporter (OTLP over HTTP by default), headers and service name come from the standard OTEL_* environment variables.
process.env.OTEL_SERVICE_NAME ??= "4core-okr";

const sdk = new NodeSDK({
  instrumentations: [
    getNodeAutoInstrumentations({
      "@opentelemetry/instrumentation-fs": { enabled: false }, // one span per file read drowns the useful ones
      "@opentelemetry/instrumentation-dns": { enabled: false },
      "@opentelemetry/instrumentation-net": { enabled: false },
    }),
  ],
});

sdk.start();

// flush buffered spans on a normal shutdown
process.once("SIGTERM", () => { void sdk.shutdown(); });
