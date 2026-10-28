import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { db } from "./db.js";
import { customerScope, leadScope, opportunityScope } from "./access.js";
import { asyncRoute, HttpError, principal } from "./http.js";
import { actions, chatSchema, retrieveContext } from "./copilot-context.js";
import { azureSettings, createAzureAgentCompletion, createAzureCompletion, type Completion, type CompletionResult } from "./azure.js";
import { salesRankingAnswer } from "./copilot-sales.js";
import { executeCopilotTool } from "./copilot-tools.js";
import type { CopilotVisual } from "./copilot-visual.js";

function visualizationAnswer(visual: CopilotVisual): CompletionResult {
  const type = visual.type === "bar" ? "batang" : visual.type === "line" ? "garis" : visual.type === "pie" ? "lingkaran" : "alur";
  const highest = visual.points.reduce<(typeof visual.points)[number] | undefined>((current, point) =>
    !current || point.value > current.value ? point : current, undefined);
  const value = (amount: number) => visual.unit === "IDR"
    ? `Rp${new Intl.NumberFormat("id-ID").format(amount)}`
    : `${new Intl.NumberFormat("id-ID").format(amount)} ${visual.unit}`;
  const highlight = highest && highest.value > 0
    ? `Nilai tertinggi pada grafik adalah **${highest.label}** (${value(highest.value)}).`
    : "Belum ada nilai tercatat untuk ditonjolkan pada grafik.";
  return {
    answer: `Grafik ${type} **${visual.title}** sudah dibuat dari data CRM.\n\n${highlight}\n\n${visual.description}`,
    truncated: false,
  };
}

export function createCopilotRouter(complete?: Completion) {
  const router = Router();
  const completion: Completion = complete ?? ((context, prompt, signal) =>
    createAzureCompletion(azureSettings())(context, prompt, signal));
  const agentCompletion = complete ? undefined : createAzureAgentCompletion(azureSettings());
  const inFlight = new Set<string>();
  router.get("/status", asyncRoute(async (req, res) => {
    res.json({ configured: Boolean(azureSettings()), scope: principal(req).role === "SALES" ? "own" : "company", actions });
  }));
  router.get("/records", asyncRoute(async (req, res) => {
    const { entity, search } = z.object({ entity: z.enum(["customers", "leads", "opportunities"]), search: z.string().trim().max(100).default("") }).strict().parse(req.query);
    const user = principal(req);
    const options = { select: { id: true, name: true }, take: 8, orderBy: { name: "asc" as const } };
    const name = { contains: search, mode: "insensitive" as const };
    const records = entity === "customers" ? await db.customer.findMany({ ...options, where: { ...customerScope(user), name } })
      : entity === "leads" ? await db.lead.findMany({ ...options, where: { ...leadScope(user), name } })
      : await db.opportunity.findMany({ ...options, where: { ...opportunityScope(user), name } });
    res.json({ records });
  }));
  router.post("/chat", rateLimit({ windowMs: 60000, limit: 12, keyGenerator: req => principal(req).id, standardHeaders: "draft-7", legacyHeaders: false, message: { message: "Copilot membatasi 12 permintaan per menit. Tunggu sebentar sebelum mencoba lagi." } }), asyncRoute(async (req, res) => {
    const user = principal(req);
    const parsed = chatSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "Periksa pertanyaan, pilihan data, dan pengaturan grafik. Maksimal 600 karakter; diagram alur hanya untuk proses penjualan.");
    const input = parsed.data;
    if (inFlight.has(user.id)) throw new HttpError(409, "Copilot masih memproses jawaban sebelumnya. Tunggu sebentar.");
    inFlight.add(user.id);
    const controller = new AbortController();
    const cancel = () => { if (!res.writableEnded) controller.abort(); };
    res.on("close", cancel);
    try {
      const context = await retrieveContext(user, input);
      controller.signal.throwIfAborted();
      const runCompletion = (prompt: string) => agentCompletion && !input.recordId
        ? agentCompletion(context.context, prompt, controller.signal,
          (name, args) => executeCopilotTool(name, args, user, context.sources))
        : completion(context.context, prompt, controller.signal);
      let result = context.visualization
        ? visualizationAnswer(context.visualization)
        : context.salesRanking
        ? { answer: salesRankingAnswer(context.salesRanking), truncated: false }
        : await runCompletion(input.prompt);
      const validReferences = new Set(context.sources.map(source => source.ref));
      const hasUnknownReference = (answer: string) => [...answer.matchAll(/\[(S\d+)\]/g)].some(match => !validReferences.has(match[1]!));
      if (!context.salesRanking && !context.visualization && hasUnknownReference(result.answer)) {
        controller.signal.throwIfAborted();
        const correction = validReferences.size
          ? `Gunakan hanya rujukan berikut pada fakta yang cocok: ${[...validReferences].map(ref => `[${ref}]`).join(", ")}. Agregat tanpa ref harus dijelaskan tanpa sitasi.`
          : "Hasil kueri ini hanya berisi agregat tanpa rujukan individual. Jangan tulis sitasi [S...] apa pun; jelaskan angka agregat langsung dari fakta.";
        result = await runCompletion(`${input.prompt}\n\nValidasi server: jawaban sebelumnya ditolak karena sitasi tidak tersedia. Tulis ulang berdasarkan fakta yang sama. ${correction}`);
        if (hasUnknownReference(result.answer)) throw new HttpError(502, "Jawaban Copilot memuat rujukan yang tidak tersedia dalam hasil kueri, termasuk setelah satu percobaan perbaikan otomatis. Silakan kirim ulang pertanyaan.");
      }
      if (!res.destroyed) res.json({ ...result, action: context.action, answerSource: context.visualization ? "visualization" : context.salesRanking ? "database" : result.toolsUsed ? "tools" : "ai", visualization: context.visualization, sources: context.sources, scope: context.scope, asOf: context.asOf, contextBytes: context.bytes });
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    } finally {
      inFlight.delete(user.id);
      res.off("close", cancel);
    }
  }));
  return router;
}
