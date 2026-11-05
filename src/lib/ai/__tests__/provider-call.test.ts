import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { callProvider, costUsd, ProviderFailure, type ProviderTarget } from "../provider-call";

// the sink listens on 127.0.0.1, which the address check refuses in real use: this switches it off for these tests only
process.env.INTEGRATIONS_ALLOW_PRIVATE_HOSTS = "true";

interface Seen { url?: string; headers: IncomingMessage["headers"]; body: string }
let http: Server; let base = ""; const seen: Seen[] = [];
let reply: (n: number, res: ServerResponse) => void = (_n, res) => { res.statusCode = 200; res.end("{}"); };
const noSleep = async () => undefined;
const limits = { timeoutMs: 2000, maxRetries: 2, sleep: noSleep };
const req = { system: "You are a careful assistant.", messages: [{ role: "user" as const, content: "How are we doing?" }], maxTokens: 100 };
const anthropic = (extra: Record<string, unknown> = {}): ProviderTarget => ({ kind: "ANTHROPIC", settings: { model: "model-a", baseUrl: base, ...extra }, apiKey: "sk-secret-key-123" });
const compat = (): ProviderTarget => ({ kind: "OPENAI_COMPATIBLE", settings: { model: "model-b", baseUrl: `${base}/v1` }, apiKey: "sk-secret-key-123" });
const ok = (res: ServerResponse, body: unknown) => { res.statusCode = 200; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(body)); };

beforeAll(async () => {
  http = createServer((r, res) => { let b = ""; r.on("data", (c) => b += c); r.on("end", () => { seen.push({ url: r.url, headers: r.headers, body: b }); reply(seen.length, res); }); });
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
});
afterAll(() => { http.close(); });
beforeEach(() => { seen.length = 0; });

describe("the AI provider call", () => {
  it("sends an Anthropic request and reads the text and the tokens", async () => {
    reply = (_n, res) => ok(res, { model: "model-a", content: [{ type: "text", text: "Hello " }, { type: "text", text: "there" }], usage: { input_tokens: 11, output_tokens: 4 } });
    const r = await callProvider(anthropic(), req, limits);
    expect(r).toMatchObject({ text: "Hello there", inputTokens: 11, outputTokens: 4, model: "model-a", attempts: 1 });
    expect(seen[0].url).toBe("/v1/messages");
    expect(seen[0].headers["x-api-key"]).toBe("sk-secret-key-123");
    expect(JSON.parse(seen[0].body)).toMatchObject({ model: "model-a", max_tokens: 100, system: "You are a careful assistant." });
  });

  it("sends an OpenAI-compatible request with the system text first", async () => {
    reply = (_n, res) => ok(res, { model: "model-b", choices: [{ message: { content: "Fine." } }], usage: { prompt_tokens: 9, completion_tokens: 2 } });
    const r = await callProvider(compat(), req, limits);
    expect(r).toMatchObject({ text: "Fine.", inputTokens: 9, outputTokens: 2 });
    expect(seen[0].url).toBe("/v1/chat/completions");
    expect(seen[0].headers.authorization).toBe("Bearer sk-secret-key-123");
    expect(JSON.parse(seen[0].body).messages[0]).toEqual({ role: "system", content: "You are a careful assistant." });
  });

  it("retries a server error and a rate limit, then succeeds", async () => {
    reply = (n, res) => { if (n === 1) { res.statusCode = 503; res.end("{}"); } else if (n === 2) { res.statusCode = 429; res.end("{}"); } else ok(res, { content: [{ type: "text", text: "done" }] }); };
    const r = await callProvider(anthropic(), req, limits);
    expect(r.text).toBe("done");
    expect(r.attempts).toBe(3);
    expect(seen).toHaveLength(3);
  });

  it("gives up after the retry limit with a plain message", async () => {
    reply = (_n, res) => { res.statusCode = 500; res.end(JSON.stringify({ error: { message: "boom" } })); };
    await expect(callProvider(anthropic(), req, { ...limits, maxRetries: 1 })).rejects.toMatchObject({ reason: "PROVIDER_ERROR", attempts: 2 });
    expect(seen).toHaveLength(2);
  });

  it("does not retry a refusal such as a bad key, and never shows the key", async () => {
    reply = (_n, res) => { res.statusCode = 401; res.end(JSON.stringify({ error: { message: "invalid x-api-key sk-secret-key-123" } })); };
    const e = await callProvider(anthropic(), req, limits).catch((x) => x as ProviderFailure);
    expect(e).toBeInstanceOf(ProviderFailure);
    expect((e as ProviderFailure).message).toContain("rejected the API key");
    expect((e as ProviderFailure).message).not.toContain("sk-secret-key-123");
    expect(seen).toHaveLength(1);
  });

  it("stops at the timeout", async () => {
    reply = () => undefined;     // never answers
    await expect(callProvider(anthropic(), req, { ...limits, timeoutMs: 150, maxRetries: 0 })).rejects.toMatchObject({ reason: "TIMEOUT" });
  });

  it("does not follow a redirect", async () => {
    reply = (_n, res) => { res.statusCode = 302; res.setHeader("location", "http://169.254.169.254/latest/meta-data"); res.end(); };
    await expect(callProvider(anthropic(), req, limits)).rejects.toThrow(/redirect/);
    expect(seen).toHaveLength(1);
  });

  it("refuses an unreadable answer without retrying", async () => {
    reply = (_n, res) => ok(res, { unexpected: true });
    await expect(callProvider(anthropic(), req, limits)).rejects.toThrow(/could not be read/);
    expect(seen).toHaveLength(1);
  });

  it("needs a model", async () => {
    await expect(callProvider({ kind: "ANTHROPIC", settings: { baseUrl: base }, apiKey: "k" }, req, limits)).rejects.toMatchObject({ reason: "NOT_CONFIGURED" });
    expect(seen).toHaveLength(0);
  });

  it("prices a call from the configured price per million tokens, and records nothing where no price is set", () => {
    expect(costUsd(1_000_000, 500_000, 3, 15)).toBeCloseTo(10.5, 6);
    expect(costUsd(1234, 567, 0, 0)).toBe(0);
  });
});
