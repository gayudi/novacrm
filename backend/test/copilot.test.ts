import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import request from "supertest";
import { azureSettings, createAzureCompletion, MAX_COMPLETION_TOKENS } from "../src/azure.js";
import { createCopilotRouter } from "../src/copilot.js";
import { chatSchema, resolveCopilotAction } from "../src/copilot-context.js";
import { resolveVisualRequest, visualRequestSchema } from "../src/copilot-visual.js";
import { HttpError } from "../src/http.js";
import { salesRankingAnswer, salesRankingRequest } from "../src/copilot-sales.js";

const settings = { endpoint: "https://example.openai.azure.com/openai/v1/chat/completions", key: "synthetic-test-key", deployment: "test-chat" };
const signal = () => new AbortController().signal;
const reply = (content: string | null = "Test answer", finish_reason = "stop") => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason }] }));
const status = (expected: number) => (error: unknown) => error instanceof HttpError && error.status === expected;

test("the same Copilot router sees local configuration changes without a server restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "nova-router-"));
  const file = join(directory, ".env");
  const keys = ["AZURE_OPENAI_ENV_FILE", "AZURE_OPENAI_ENDPOINT", "AZURE_OPENAI_KEY", "AZURE_OPENAI_DEPLOYMENT"];
  const previous = keys.map(key => process.env[key]);
  try {
    for (const key of keys) delete process.env[key];
    process.env.AZURE_OPENAI_ENV_FILE = file;
    writeFileSync(file, "");
    const app = express();
    app.use((req, _res, next) => { req.user = { id: "test-user", name: "Test", email: "test@example.com", role: "SALES" }; next(); });
    app.use(createCopilotRouter());
    assert.equal((await request(app).get("/status").expect(200)).body.configured, false);
    writeFileSync(file, "AZURE_OPENAI_ENDPOINT=https://example.openai.azure.com\nAZURE_OPENAI_KEY=synthetic-test-key\nAZURE_OPENAI_DEPLOYMENT=test-chat\n");
    const response = (await request(app).get("/status").expect(200)).body;
    assert.equal(response.configured, true);
    assert.equal(response.scope, "own");
    assert.equal(JSON.stringify(response).includes("synthetic-test-key"), false);
    writeFileSync(file, "");
    assert.equal((await request(app).get("/status").expect(200)).body.configured, false);
  } finally {
    keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
    unlinkSync(file); rmdirSync(directory);
  }
});

test("local Azure file is re-read without changing database/auth settings or mixing configuration sources", () => {
  const directory = mkdtempSync(join(tmpdir(), "nova-azure-"));
  const file = join(directory, ".env");
  const environment = { AZURE_OPENAI_ENV_FILE: file };
  const database = process.env.DATABASE_URL;
  const secret = process.env.JWT_SECRET;
  try {
    assert.equal(azureSettings(environment), null);
    writeFileSync(file, `DATABASE_URL=do-not-load\nJWT_SECRET=do-not-load\nAZURE_OPENAI_ENDPOINT=https://example.openai.azure.com\nAZURE_OPENAI_KEY=synthetic-test-key\nAZURE_OPENAI_DEPLOYMENT=test-chat\n`);
    assert.deepEqual(azureSettings(environment), settings);
    writeFileSync(file, "AZURE_OPENAI_ENDPOINT=\nAZURE_OPENAI_KEY=\nAZURE_OPENAI_DEPLOYMENT=\n");
    assert.equal(azureSettings(environment), null, "Cleared credentials are not cached");
    writeFileSync(file, "AZURE_OPENAI_ENDPOINT=https://example.openai.azure.com\nAZURE_OPENAI_KEY=synthetic-test-key\nAZURE_OPENAI_DEPLOYMENT=test-chat\n");
    assert.equal(azureSettings({ ...environment, AZURE_OPENAI_ENDPOINT: "https://different.openai.azure.com" }), null, "Partial process settings never borrow a local key");
    assert.deepEqual(azureSettings({ ...environment, AZURE_OPENAI_ENDPOINT: "https://example.openai.azure.com", AZURE_OPENAI_KEY: settings.key, AZURE_OPENAI_DEPLOYMENT: settings.deployment }), settings);
    assert.throws(() => azureSettings({ AZURE_OPENAI_ENV_FILE: directory }), status(503));
    assert.equal(process.env.DATABASE_URL, database);
    assert.equal(process.env.JWT_SECRET, secret);
  } finally { unlinkSync(file); rmdirSync(directory); }
});

test("Azure configuration is optional and accepts resource root or v1 URL, never query credentials", () => {
  assert.equal(azureSettings({}), null);
  assert.equal(azureSettings({ AZURE_OPENAI_ENDPOINT: "https://example.openai.azure.com" }), null);
  const env = { AZURE_OPENAI_ENDPOINT: "https://example.openai.azure.com", AZURE_OPENAI_KEY: settings.key, AZURE_OPENAI_DEPLOYMENT: settings.deployment };
  assert.deepEqual(azureSettings(env), settings);
  assert.deepEqual(azureSettings({ ...env, AZURE_OPENAI_ENDPOINT: "https://example.openai.azure.com/openai/v1/" }), settings);
  for (const endpoint of ["http://example.com", "not a URL", "https://example.com?key=secret", "https://user:pass@example.com", "https://example.com/deployments"]) {
    assert.equal(azureSettings({ ...env, AZURE_OPENAI_ENDPOINT: endpoint }), null);
  }
});

test("chat rejects scope overrides, SQL actions, oversized questions and incorrect record selection", () => {
  const input = { action: "customer_360", recordId: "customer", prompt: "Summarize" };
  assert.equal(chatSchema.safeParse(input).success, true);
  for (const override of [{ ownerId: "other" }, { history: [] }, { action: "sql" }, { prompt: "x".repeat(601) }, { recordId: undefined }, { action: "executive_summary" }]) {
    assert.equal(chatSchema.safeParse({ ...input, ...override }).success, false);
  }
});

test("latest-lead prompts select fixed retrieval without overriding a selected record or accepting scope fields", () => {
  for (const prompt of ["10 lead terakhir", "Tampilkan 10 leads terbaru saya", "Show the latest 10 leads", "Show the 10 latest leads", "last 10 leads", "recent leads"]) {
    assert.equal(resolveCopilotAction({ action: "executive_summary", prompt }), "latest_leads", prompt);
  }
  for (const prompt of ["Summarize lead sources", "10 transaksi terakhir", "Latest opportunities", "Leadership review"]) {
    assert.equal(resolveCopilotAction({ action: "executive_summary", prompt }), "executive_summary", prompt);
  }
  assert.equal(resolveCopilotAction({ action: "lead_summary", recordId: "selected", prompt: "10 lead terakhir" }), "lead_summary");
  assert.equal(chatSchema.safeParse({ action: "latest_leads", prompt: "Show leads" }).success, true);
  assert.equal(chatSchema.safeParse({ action: "latest_leads", recordId: "selected", prompt: "Show leads" }).success, false);
  assert.equal(chatSchema.safeParse({ action: "latest_leads", ownerId: "other", prompt: "Show leads" }).success, false);
});

test("visual requests select only supported metrics/types and reject unknown topics or record-level scope", () => {
  const cases = [
    ["Buatkan grafik garis pendapatan", "line", "revenue_monthly"],
    ["Buat grafik batang penjualan per cabang", "bar", "sales_branch"],
    ["Diagram lingkaran sumber lead", "pie", "lead_sources"],
    ["Diagram lingkaran status lead", "pie", "lead_statuses"],
    ["Grafik tren lead bulanan", "line", "leads_monthly"],
    ["Grafik produk terlaris", "bar", "top_products"],
    ["Grafik peluang per tahap", "bar", "pipeline_stages"],
    ["Buatkan diagram alur proses penjualan", "flow", "sales_process"],
    ["Show a pie chart of lead sources", "pie", "lead_sources"],
  ] as const;
  for (const [prompt, type, metric] of cases) assert.deepEqual(resolveVisualRequest({ action: "executive_summary", prompt }), { type, metric });
  assert.equal(resolveVisualRequest({ action: "executive_summary", prompt: "Ringkas pendapatan" }), undefined);
  for (const prompt of ["Buat grafik", "Buat diagram cuaca", "Buat diagram alur login", "Buat grafik per sales bulan ini"]) {
    assert.throws(() => resolveVisualRequest({ action: "executive_summary", prompt }), status(400));
  }
  assert.throws(() => resolveVisualRequest({ action: "customer_360", prompt: "Buat grafik pendapatan", recordId: "customer" }), status(400));
  const visualization = { type: "pie", metric: "lead_sources" } as const;
  assert.deepEqual(resolveVisualRequest({ action: "visualization", prompt: "Jelaskan", visualization }), visualization);
  for (const invalid of [{ type: "html", metric: "lead_sources" }, { type: "flow", metric: "lead_sources" }, { type: "bar", metric: "sales_process" }, { ...visualization, points: [{ value: 999 }] }]) {
    assert.equal(visualRequestSchema.safeParse(invalid).success, false);
  }
  assert.equal(chatSchema.safeParse({ action: "visualization", prompt: "Buat grafik", visualization }).success, true);
  assert.equal(chatSchema.safeParse({ action: "executive_summary", prompt: "Buat grafik", visualization }).success, false);
});

test("salesperson questions including screenshot typo route to people rather than products", () => {
  for (const prompt of [
    "berikan informasi sales palinb banyak jualan bulan ini",
    "berikan informasi sales paling banyak jualan bulan ini", "siapa sales dengan omzet tertinggi bulan ini?",
    "Top 3 sales bulan ini", "Peringkat sales berdasarkan transaksi", "siapa yang paling banyak menjual bulan ini?",
    "Which salesperson has the highest revenue this month?", "Top salespeople by units this month",
  ]) assert.equal(resolveCopilotAction({ action: "executive_summary", prompt }), "salesperson_ranking", prompt);
  for (const prompt of ["Produk paling banyak terjual bulan ini", "Top product sales", "Sales trend this month", "Ringkas pendapatan", "Top products"]) {
    assert.equal(resolveCopilotAction({ action: "executive_summary", prompt }), "executive_summary", prompt);
  }
  assert.equal(resolveCopilotAction({ action: "lead_summary", recordId: "selected", prompt: "siapa sales terbaik?" }), "lead_summary");
  assert.equal(chatSchema.safeParse({ action: "salesperson_ranking", recordId: "selected", prompt: "ranking" }).success, false);
  assert.deepEqual(salesRankingRequest("sales paling banyak jualan bulan ini"), { metric: "revenue", limit: 5 });
  assert.deepEqual(salesRankingRequest("top 3 sales berdasarkan transaksi bulan ini"), { metric: "transactions", limit: 3 });
  assert.deepEqual(salesRankingRequest("top 10 sales berdasarkan unit bulan ini"), { metric: "units", limit: 10 });
  assert.equal(salesRankingRequest("peringkat sales berdasarkan omzet dan tampilkan transaksi serta unit").metric, "revenue");
  for (const prompt of ["sales terbaik bulan lalu", "top sales minggu ini", "top sales Oktober 2026", "top sales di Bandung", "sales terbanyak menjual iPhone", "top 11 sales bulan ini"]) {
    assert.throws(() => salesRankingRequest(prompt), status(400), prompt);
  }
});

test("sales ranking rendering safely displays names and distinguishes scope, zero data, units and ties", () => {
  const base = {
    ...salesRankingRequest("top 1 sales"), scope: "company" as const, start: "2026-09-30T17:00:00Z", asOf: "2026-10-27T13:00:00Z",
    totalSalespeople: 2, missingItemTransactions: 1,
    rows: [{ name: "[Klik](https://bad.invalid)|<img>\n**palsu**", rank: 1, revenueIDR: 9000000, transactions: 2, units: 3 }],
  };
  const answer = salesRankingAnswer(base);
  assert.match(answer, /Rp9\.000\.000/);
  assert.match(answer, /1 Oktober 2026/);
  assert.match(answer, /1 dari 2 sales/);
  assert.match(answer, /Nilai yang sama berbagi peringkat/);
  assert.match(answer, /tidak memiliki item/);
  assert.equal(answer.includes("[Klik](https://bad.invalid)"), false);
  assert.equal(answer.includes("|<img>"), false);
  const own = salesRankingAnswer({ ...base, scope: "own" });
  assert.match(own, /bukan peringkat seluruh perusahaan/);
  assert.doesNotMatch(own, /berada pada peringkat/);
  assert.match(salesRankingAnswer({ ...base, rows: [] }), /Tidak ada sales teratas/);
});

test("Azure transport sends only bounded context/current question, fixed instructions and capped output", async () => {
  let called = false;
  const transport: typeof fetch = async (url, options) => {
    called = true;
    assert.equal(url, settings.endpoint);
    assert.equal(new Headers(options?.headers).get("api-key"), settings.key);
    assert.equal(options?.redirect, "error");
    const body = JSON.parse(String(options?.body));
    assert.equal(body.model, settings.deployment);
    assert.equal(body.max_completion_tokens, MAX_COMPLETION_TOKENS);
    assert.equal(body.messages.length, 2);
    assert.match(body.messages[0].content, /Always answer exclusively in Bahasa Indonesia/);
    assert.match(body.messages[0].content, /even when the question requests another language/);
    assert.match(body.messages[0].content, /do not output chart code, HTML, SVG or Mermaid/);
    assert.match(body.messages[0].content, /Return readable Markdown/);
    assert.match(body.messages[0].content, /Inti keputusan/);
    assert.match(body.messages[0].content, /not a calibrated prediction/);
    assert.match(body.messages[0].content, /Zero completed sales alone does not establish high risk/);
    assert.match(body.messages[0].content, /dueAt is a scheduled date/);
    assert.match(body.messages[0].content, /Incomplete month-to-date/);
    assert.match(body.messages[0].content, /use completedMonthsComparison/);
    assert.match(body.messages[0].content, /Lead-source counts alone do not measure marketing effectiveness/);
    assert.match(body.messages[0].content, /Never substitute topProducts for a salesperson ranking/);
    assert.match(body.messages[0].content, /use topProductsByUnitsMTD/);
    assert.match(body.messages[0].content, /Product rankings are aggregates without individual-record citations/);
    assert.equal(body.max_completion_tokens, 1200);
    assert.match(body.messages[1].content, /"count":2/);
    assert.equal(body.tools, undefined);
    assert.equal(body.messages[1].content.includes(settings.key), false);
    assert.ok(Buffer.byteLength(String(options?.body)) < 10000);
    return reply();
  };
  assert.deepEqual(await createAzureCompletion(settings, transport)('{"count":2}', "Summarize", signal()), { answer: "Test answer", truncated: false });
  assert.ok(called);
});

test("missing configuration, Azure errors and invalid output fail explicitly without provider-secret leakage", async () => {
  await assert.rejects(createAzureCompletion(null)("{}", "Question", signal()), status(503));
  for (const [provider, expected] of [[401, 502], [403, 502], [404, 502], [429, 429], [500, 502]] as const) {
    const complete = createAzureCompletion(settings, async () => new Response("SENSITIVE_PROVIDER_BODY", { status: provider }));
    await assert.rejects(complete("{}", "Question", signal()), error => status(expected)(error) && error instanceof Error && !error.message.includes("SENSITIVE"));
  }
  for (const response of [new Response("invalid"), new Response("{}"), new Response("x".repeat(65537)), reply(null)]) {
    await assert.rejects(createAzureCompletion(settings, async () => response)("{}", "Question", signal()), status(502));
  }
  await assert.rejects(createAzureCompletion(settings, async () => reply(null, "content_filter"))("{}", "Question", signal()), status(422));
  assert.equal((await createAzureCompletion(settings, async () => reply("Partial", "length"))("{}", "Question", signal())).truncated, true);
  await assert.rejects(createAzureCompletion(settings, async () => { throw new Error("secret transport details"); })("{}", "Question", signal()), status(502));
});

test("Azure timeout and user cancellation stop the request", async () => {
  const delayed: typeof fetch = async (_url, options) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(reply()), 500);
    const abort = () => { clearTimeout(timer); reject(options?.signal?.reason); };
    if (options?.signal?.aborted) abort();
    else options?.signal?.addEventListener("abort", abort, { once: true });
  });
  await assert.rejects(createAzureCompletion(settings, delayed, 10)("{}", "Question", signal()), status(504));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(createAzureCompletion(settings, delayed)("{}", "Question", controller.signal), status(499));
});
