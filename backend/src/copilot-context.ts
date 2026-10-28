import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "./db.js";
import { activityScope, contactScope, customerScope, leadScope, opportunityScope, transactionScope } from "./access.js";
import { HttpError, type Principal } from "./http.js";
import { monthStart } from "./dashboard.js";
import { crmLabel, resolveVisualRequest, retrieveVisual, visualRequestSchema, type CopilotVisual } from "./copilot-visual.js";
import { isSalespersonQuestion, retrieveSalesRanking, salesRankingRequest, type SalesRanking } from "./copilot-sales.js";

export const actions = [
  "customer_summary", "lead_summary", "opportunity_summary", "customer_360",
  "pipeline_review", "sales_forecast", "risk_analysis", "executive_summary",
  "latest_leads", "visualization", "salesperson_ranking",
] as const;
export const chatSchema = z.object({
  action: z.enum(actions),
  recordId: z.string().trim().min(1).max(100).optional(),
  prompt: z.string().trim().min(1).max(600),
  visualization: visualRequestSchema.optional(),
}).strict().superRefine((data, ctx) => {
  const needsRecord = ["customer_summary", "customer_360", "lead_summary", "opportunity_summary"].includes(data.action);
  if (needsRecord !== Boolean(data.recordId)) ctx.addIssue({ code: "custom", path: ["recordId"], message: needsRecord ? "Pilih data terlebih dahulu." : "Tugas ini tidak menerima pilihan data individual." });
  if (data.visualization && data.action !== "visualization") ctx.addIssue({ code: "custom", path: ["visualization"], message: "Pengaturan grafik hanya diterima pada tugas visualisasi." });
});
export type ChatInput = z.infer<typeof chatSchema>;
export function resolveCopilotAction(input: ChatInput): ChatInput["action"] {
  if (!input.recordId && isSalespersonQuestion(input.prompt)) return "salesperson_ranking";
  const latestLeads = /\b(?:leads?\s+(?:terakhir|terbaru)|(?:latest|last|newest|recent)\s+(?:\d+\s+)?leads?|\d+\s+(?:latest|last|newest|recent)\s+leads?)\b/i;
  return !input.recordId && latestLeads.test(input.prompt) ? "latest_leads" : input.action;
}
export type Source = { ref: string; resource: "customers" | "contacts" | "leads" | "opportunities" | "activities" | "transactions" | "products"; id: string; label: string; createdAt?: string; updatedAt?: string };
export const MAX_CONTEXT_BYTES = 6000;
const opportunitySelect = { id: true, name: true, stage: true, branch: true, value: true, probability: true, expectedCloseDate: true, updatedAt: true } as const;
const activitySelect = { id: true, subject: true, type: true, status: true, dueAt: true } as const;

export async function retrieveContext(user: Principal, input: ChatInput, now = new Date()) {
  if (input.recordId && isSalespersonQuestion(input.prompt)) throw new HttpError(400, "Untuk peringkat salesperson, pilih tugas Peringkat sales tanpa memilih data individual.");
  const visualRequest = resolveVisualRequest(input);
  const action = visualRequest ? "visualization" : resolveCopilotAction(input);
  let visualization: CopilotVisual | undefined;
  let salesRanking: SalesRanking | undefined;
  const sources: Source[] = [];
  function source(resource: Source["resource"], id: string, label: string, timestamps?: { createdAt: Date; updatedAt: Date }) {
    const existing = sources.find(item => item.resource === resource && item.id === id);
    if (existing) return existing.ref;
    const ref = `S${sources.length + 1}`;
    sources.push({ ref, resource, id, label: label.slice(0, 150), ...(timestamps ? { createdAt: timestamps.createdAt.toISOString(), updatedAt: timestamps.updatedAt.toISOString() } : {}) });
    return ref;
  }
  const facts = await db.$transaction(async tx => {
    const opportunities = async (where: Prisma.OpportunityWhereInput) => {
      const rows = await tx.opportunity.findMany({ where: { AND: [opportunityScope(user), where] }, select: opportunitySelect, orderBy: [{ value: "desc" }, { id: "asc" }], take: 5 });
      return rows.map(({ id, name, ...row }) => ({ ref: source("opportunities", id, name), ...row }));
    };
    const activities = async (where: Prisma.ActivityWhereInput) => {
      const rows = await tx.activity.findMany({ where: { AND: [activityScope(user), where] }, select: activitySelect, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take: 4 });
      return rows.map(({ id, subject, ...row }) => ({ ref: source("activities", id, subject), ...row }));
    };
    const open: Prisma.OpportunityWhereInput = { stage: { notIn: ["WON", "LOST"] } };
    const pipeline = async () => {
      const rows = await tx.opportunity.groupBy({ by: ["stage"], where: { ...opportunityScope(user), ...open }, _sum: { value: true }, _count: true });
      return rows.map(row => ({ stage: row.stage, count: row._count, valueIDR: Number(row._sum.value ?? 0) }));
    };
    const revenue = async () => Promise.all(Array.from({ length: 3 }, async (_, index) => {
      const start = monthStart(now, index - 2);
      const end = index === 2 ? now : monthStart(now, index - 1);
      const row = await tx.salesTransaction.aggregate({ where: { ...transactionScope(user), status: "COMPLETED", soldAt: { gte: start, lt: end } }, _sum: { total: true }, _count: true });
      return { month: start.toISOString().slice(0, 7), monthToDate: index === 2, revenueIDR: Number(row._sum.total ?? 0), transactions: row._count };
    }));
    const topProducts = async (where: Prisma.SalesTransactionWhereInput, metric: "revenue" | "units" = "revenue") => {
      const rows = await tx.salesTransactionItem.groupBy({
        by: ["productId"], where: { transaction: { AND: [transactionScope(user), where] } },
        _sum: { quantity: true, subtotal: true },
        orderBy: [metric === "units" ? { _sum: { quantity: "desc" } } : { _sum: { subtotal: "desc" } }, { productId: "asc" }], take: 3,
      });
      const products = await tx.product.findMany({ where: { id: { in: rows.map(row => row.productId) } }, select: { id: true, name: true } });
      return rows.map(row => ({ product: products.find(p => p.id === row.productId)!.name.slice(0, 150), units: row._sum.quantity, revenueIDR: Number(row._sum.subtotal ?? 0) }));
    };

    switch (action) {
      case "salesperson_ranking": {
        salesRanking = await retrieveSalesRanking(tx, user, salesRankingRequest(input.prompt), now);
        return {
          ...salesRanking, timeZone: "Asia/Jakarta", entity: "salesperson",
          rows: salesRanking.rows.map(({ name: _name, ...row }, index) => ({ salesperson: `Sales ${index + 1}`, ...row })),
          instruction: "Exact salesperson ranking, not a product ranking. The server renders names and numbers directly; no model inference is needed.",
        };
      }
      case "visualization": {
        if (!visualRequest) throw new HttpError(400, "Pilih jenis grafik dan topik datanya.");
        visualization = await retrieveVisual(tx, user, visualRequest, now);
        return { visualization, instruction: "Grafik atau diagram ini sudah dirender oleh aplikasi. Jelaskan dalam Bahasa Indonesia berdasarkan angka dan batas periode ini saja. Jangan mengeluarkan kode, HTML, SVG atau Mermaid. Jangan mengaku tidak bisa membuat grafik. Jelaskan keterbatasan/filter yang tidak tersedia; jangan mengklaim filter tambahan telah diterapkan." };
      }
      case "latest_leads": {
        const where = leadScope(user);
        const [totalVisible, rows] = await Promise.all([
          tx.lead.count({ where }),
          tx.lead.findMany({
            where, take: 10, orderBy: [{ createdAt: "desc" }, { id: "asc" }],
            select: { id: true, name: true, source: true, status: true, branch: true, createdAt: true, updatedAt: true },
          }),
        ]);
        const clock = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "medium", timeZone: "Asia/Jakarta" });
        return {
          order: "createdAt DESC, id ASC", timeZone: "Asia/Jakarta (WIB, UTC+07:00)",
          limit: 10, returned: rows.length, totalVisible,
          criteria: "Most recently created permitted leads, not most recently updated. No other filters applied. List the requested number up to 10, in this order, with references and supplied creation times. If fewer exist, state the actual count; never invent missing records.",
          leads: rows.map(({ id, name, ...row }) => ({
            ref: source("leads", id, name, row), ...row, createdAtWIB: `${clock.format(row.createdAt)} WIB`,
          })),
        };
      }
      case "customer_summary":
      case "customer_360": {
        const row = await tx.customer.findFirst({ where: { ...customerScope(user), id: input.recordId }, select: { id: true, name: true, status: true, segment: true, branch: true, createdAt: true } });
        if (!row) throw new HttpError(404, "Pelanggan tidak ditemukan.");
        const { id, name, ...profile } = row;
        const ref = source("customers", id, name);
        const [sales, contacts, activityCounts, deals] = await Promise.all([
          tx.salesTransaction.aggregate({ where: { ...transactionScope(user), customerId: id, status: "COMPLETED" }, _sum: { total: true }, _count: true, _max: { soldAt: true } }),
          tx.contact.count({ where: { ...contactScope(user), customerId: id } }),
          tx.activity.groupBy({ by: ["status"], where: { ...activityScope(user), customerId: id }, _count: true }),
          tx.opportunity.groupBy({ by: ["stage"], where: { ...opportunityScope(user), customerId: id }, _sum: { value: true }, _count: true }),
        ]);
        const base = { ref, ...profile, contacts, completedSales: sales._count, lifetimeRevenueIDR: Number(sales._sum.total ?? 0), lastSaleAt: sales._max.soldAt, activityCounts, opportunitiesByStage: deals };
        if (input.action === "customer_summary") return base;
        const [recentActivities, largestOpenOpportunities, leads, topPurchasedProducts] = await Promise.all([
          activities({ customerId: id }), opportunities({ customerId: id, ...open }),
          tx.lead.groupBy({ by: ["status"], where: { ...leadScope(user), customerId: id }, _count: true }),
          topProducts({ customerId: id, status: "COMPLETED" }),
        ]);
        return { ...base, recentActivities, largestOpenOpportunities, leads, topPurchasedProducts, examplesAreLimited: true };
      }
      case "lead_summary": {
        const row = await tx.lead.findFirst({ where: { ...leadScope(user), id: input.recordId }, select: { id: true, name: true, source: true, status: true, branch: true, createdAt: true, updatedAt: true, customerId: true } });
        if (!row) throw new HttpError(404, "Lead tidak ditemukan.");
        const { id, name, customerId, ...profile } = row;
        return { ref: source("leads", id, name), ...profile, hasLinkedCustomer: Boolean(customerId), daysSinceUpdate: Math.max(0, Math.floor((now.getTime() - row.updatedAt.getTime()) / 86400000)) };
      }
      case "opportunity_summary": {
        const row = await tx.opportunity.findFirst({ where: { ...opportunityScope(user), id: input.recordId }, select: opportunitySelect });
        if (!row) throw new HttpError(404, "Peluang tidak ditemukan.");
        const { id, name, ...profile } = row;
        const ref = source("opportunities", id, name);
        const activityWhere = { ...activityScope(user), opportunityId: id };
        const [sales, statusCounts, overduePlanned, nextActivity, recentActivities] = await Promise.all([
          tx.salesTransaction.aggregate({ where: { ...transactionScope(user), opportunityId: id, status: "COMPLETED" }, _sum: { total: true }, _count: true }),
          tx.activity.groupBy({ by: ["status"], where: activityWhere, _count: true }),
          tx.activity.count({ where: { ...activityWhere, status: "PLANNED", dueAt: { lt: now } } }),
          tx.activity.findFirst({ where: { ...activityWhere, status: "PLANNED", dueAt: { gte: now } }, select: activitySelect, orderBy: [{ dueAt: "asc" }, { id: "asc" }] }),
          activities({ opportunityId: id }),
        ]);
        let nextPlannedActivity = null;
        if (nextActivity) {
          const { id: activityId, subject, ...details } = nextActivity;
          nextPlannedActivity = { ref: source("activities", activityId, subject), ...details, typeLabel: crmLabel(details.type) };
        }
        return {
          ref, ...profile, stageLabel: crmLabel(row.stage), branchLabel: crmLabel(row.branch),
          weightedValueIDR: Number(row.value.mul(row.probability).div(100)),
          completedSales: sales._count, realizedRevenueIDR: Number(sales._sum.total ?? 0),
          isOpen: !["WON", "LOST"].includes(row.stage),
          expectedCloseIsPast: row.expectedCloseDate < now,
          daysSinceUpdate: Math.max(0, Math.floor((now.getTime() - row.updatedAt.getTime()) / 86400000)),
          activityOverview: {
            countsByStatus: statusCounts.map(group => ({ status: group.status, count: group._count })),
            overduePlanned, nextPlannedActivity,
            nextPlannedBeforeExpectedClose: nextActivity ? nextActivity.dueAt <= row.expectedCloseDate : null,
            dateMeaning: "dueAt is the scheduled date, not the actual completion date. No completedAt or customer-response evidence is recorded. overduePlanned counts pending overdue activities right now, not historic delays since the opportunity update. Completed activity counts do not measure customer engagement quality.",
          },
          recentActivities, examplesAreLimited: true,
        };
      }
      case "pipeline_review":
        return { stages: await pipeline(), largestOpenOpportunities: await opportunities(open), examplesAreLimited: true };
      case "sales_forecast": {
        const end = new Date(now.getTime() + 30 * 86400000);
        const [monthlyRevenue, groups, overdue] = await Promise.all([
          revenue(),
          tx.opportunity.groupBy({ by: ["probability"], where: { ...opportunityScope(user), ...open, expectedCloseDate: { gte: now, lt: end } }, _sum: { value: true }, _count: true }),
          tx.opportunity.aggregate({ where: { ...opportunityScope(user), ...open, expectedCloseDate: { lt: now } }, _sum: { value: true }, _count: true }),
        ]);
        const elapsedDays = (now.getTime() - monthStart(now).getTime()) / 86400000;
        const daysInMonth = (monthStart(now, 1).getTime() - monthStart(now).getTime()) / 86400000;
        const weighted = groups.reduce((sum, group) => sum.add((group._sum.value ?? new Prisma.Decimal(0)).mul(group.probability).div(100)), new Prisma.Decimal(0));
        return {
          monthlyRevenue,
          next30Days: { start: now, end, opportunities: groups.reduce((sum, row) => sum + row._count, 0), weightedPipelineIDR: Number(weighted.toFixed(2)) },
          monthEndRunRateIDR: elapsedDays >= 1 ? Math.round(monthlyRevenue[2]!.revenueIDR / elapsedDays * daysInMonth) : null,
          overdue: { count: overdue._count, valueIDR: Number(overdue._sum.value ?? 0) },
          assumptions: "Run rate = completed month-to-date revenue / elapsed UTC days * calendar days; unavailable before one full day. Weighted pipeline = sum(open deal value * probability/100) closing in the next 30 days. Overdue deals excluded. These are separate estimates, not additive or guaranteed; no seasonality adjustment.",
        };
      }
      case "risk_analysis": {
        const stale = new Date(now.getTime() - 30 * 86400000);
        const risk: Prisma.OpportunityWhereInput = { ...open, OR: [{ expectedCloseDate: { lt: now } }, { updatedAt: { lt: stale } }, { probability: { lte: 20 } }] };
        const [atRisk, overdueActivities, inactiveCustomers, lostLast30Days, examples] = await Promise.all([
          tx.opportunity.aggregate({ where: { AND: [opportunityScope(user), risk] }, _sum: { value: true }, _count: true }),
          tx.activity.count({ where: { ...activityScope(user), status: "PLANNED", dueAt: { lt: now } } }),
          tx.customer.count({ where: { ...customerScope(user), status: "INACTIVE" } }),
          tx.opportunity.count({ where: { ...opportunityScope(user), stage: "LOST", updatedAt: { gte: stale, lte: now } } }),
          opportunities(risk),
        ]);
        return { criteria: "Open deals overdue, unchanged for 30 days, or probability <=20%. Lost count uses update date, not a recorded loss date.", atRiskDeals: atRisk._count, atRiskValueIDR: Number(atRisk._sum.value ?? 0), overdueActivities, inactiveCustomers, lostUpdatedLast30Days: lostLast30Days, largestAtRiskExamples: examples, examplesAreLimited: true };
      }
      case "executive_summary": {
        const [customers, leads, stages, monthlyRevenue, overdueActivities, topProductsMTD, topProductsByUnitsMTD] = await Promise.all([
          tx.customer.groupBy({ by: ["status"], where: customerScope(user), _count: true }),
          tx.lead.groupBy({ by: ["source"], where: leadScope(user), _count: true }),
          pipeline(), revenue(),
          tx.activity.count({ where: { ...activityScope(user), status: "PLANNED", dueAt: { lt: now } } }),
          topProducts({ status: "COMPLETED", soldAt: { gte: monthStart(now), lt: now } }),
          topProducts({ status: "COMPLETED", soldAt: { gte: monthStart(now), lt: now } }, "units"),
        ]);
        const previous = monthlyRevenue[0]!;
        const lastComplete = monthlyRevenue[1]!;
        const change = (current: number, baseline: number) => ({
          difference: current - baseline,
          percent: baseline > 0 ? Math.round((current - baseline) / baseline * 10000) / 100 : null,
          direction: current > baseline ? "naik" : current < baseline ? "turun" : "tetap",
        });
        return {
          customers, leadsBySource: leads, openPipeline: stages, monthlyRevenue, overdueActivities, topProductsMTD, topProductsByUnitsMTD,
          productRankingPeriod: { start: monthStart(now), endExclusive: now, timeZone: "UTC", status: "COMPLETED", limit: 3,
            criteria: "topProductsByUnitsMTD ranks recorded item quantities; topProductsMTD ranks item revenue. Equal values are tied, displayed by product ID. These are aggregates without sourceRefs, not individual transactions. Missing item records cannot contribute; do not estimate them. No extra branch/product filters applied." },
          openPipelineTotals: { opportunities: stages.reduce((total, stage) => total + stage.count, 0), valueIDR: stages.reduce((total, stage) => total + stage.valueIDR, 0) },
          completedMonthsComparison: {
            from: previous.month, to: lastComplete.month,
            revenue: change(lastComplete.revenueIDR, previous.revenueIDR),
            transactions: change(lastComplete.transactions, previous.transactions),
            interpretation: "Only this pair of full UTC calendar months supports a growth/decline statement. Explicitly name both months. Current month-to-date has no comparable elapsed-period baseline here; do not claim current-month growth or decline.",
          },
        };
      }
    }
  }, { isolationLevel: "RepeatableRead", timeout: 10000 });
  const context = JSON.stringify({ action, scope: user.role === "SALES" ? "own" : "company", asOf: now.toISOString(), currency: "IDR", sourceRefs: sources.map(item => item.ref), facts });
  const bytes = Buffer.byteLength(context, "utf8");
  if (bytes > MAX_CONTEXT_BYTES) throw new HttpError(413, "Data yang dipilih melebihi batas Copilot. Pilih ringkasan yang lebih spesifik.");
  return { action, visualization, salesRanking, context, sources, bytes, asOf: now.toISOString(), scope: user.role === "SALES" ? "own" as const : "company" as const };
}
