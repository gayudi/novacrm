import { ActivityStatus, ActivityType, Branch, CustomerStatus, LeadSource, LeadStatus, OpportunityStage, Prisma, TransactionStatus } from "@prisma/client";
import { ZodError, z } from "zod";
import { activityScope, contactScope, customerScope, leadScope, opportunityScope, transactionScope } from "./access.js";
import { db } from "./db.js";
import { HttpError, type Principal } from "./http.js";
import type { Source } from "./copilot-context.js";

const periods = ["current_week", "current_month", "previous_month", "current_quarter", "last_3_months", "current_year", "all_time"] as const;
const periodSchema = z.enum(periods).default("current_month");
type Period = z.infer<typeof periodSchema>;
type Window = { start?: Date; end?: Date; label: string };
const offset = 7 * 60 * 60 * 1000;

function periodWindow(period: Period, now: Date): Window {
  if (period === "all_time") return { label: "seluruh waktu hingga saat kueri" };
  const local = new Date(now.getTime() + offset);
  const year = local.getUTCFullYear(), month = local.getUTCMonth(), day = local.getUTCDate();
  const start = period === "current_week" ? Date.UTC(year, month, day - ((local.getUTCDay() + 6) % 7))
    : period === "current_month" ? Date.UTC(year, month, 1)
    : period === "previous_month" ? Date.UTC(year, month - 1, 1)
    : period === "current_quarter" ? Date.UTC(year, Math.floor(month / 3) * 3, 1)
    : period === "last_3_months" ? Date.UTC(year, month - 2, 1)
    : Date.UTC(year, 0, 1);
  const end = period === "current_week" ? start + 7 * 86400000
    : period === "previous_month" ? Date.UTC(year, month, 1)
    : period === "current_quarter" ? Date.UTC(year, Math.floor(month / 3) * 3 + 3, 1)
    : period === "last_3_months" ? Date.UTC(year, month + 1, 1)
    : period === "current_year" ? Date.UTC(year + 1, 0, 1)
    : Date.UTC(year, month + 1, 1);
  const beginning = new Date(start - offset);
  const ending = new Date(end - offset);
  return {
    start: beginning,
    end: period.startsWith("current_") ? now : ending,
    label: `${new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeZone: "Asia/Jakarta" }).format(beginning)} sampai ${period.startsWith("current_") ? `${new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeZone: "Asia/Jakarta" }).format(now)} (saat kueri)` : new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeZone: "Asia/Jakarta" }).format(new Date(ending.getTime() - 1))} WIB; batas akhir ${period.startsWith("current_") ? "inklusif" : "eksklusif"}`,
  };
}

const analyzeSchema = z.object({
  area: z.enum(["sales", "leads", "opportunities", "activities", "customers", "products"]),
  metric: z.enum(["revenue", "transactions", "units", "count", "value", "weighted_value", "average_value", "stock"]).default("count"),
  groupBy: z.enum(["none", "branch", "salesperson", "product", "month", "status", "source", "stage", "type", "city", "segment", "brand", "category"]).default("none"),
  period: periodSchema,
  branch: z.nativeEnum(Branch).nullish().transform(value => value ?? undefined),
  status: z.string().trim().min(1).max(40).nullish().transform(value => value ?? undefined),
  limit: z.number().int().min(1).max(10).default(10),
}).strict();
type AnalyzeInput = z.infer<typeof analyzeSchema>;

const searchSchema = z.object({
  entity: z.enum(["customers", "contacts", "leads", "opportunities", "activities", "transactions", "products"]),
  query: z.string().trim().max(100).nullish().transform(value => value ?? ""),
  period: periodSchema,
  branch: z.nativeEnum(Branch).nullish().transform(value => value ?? undefined),
  status: z.string().trim().min(1).max(40).nullish().transform(value => value ?? undefined),
  limit: z.number().int().min(1).max(10).default(5),
}).strict();

export type CopilotTool = { type: "function"; function: { name: string; description: string; strict: true; parameters: Record<string, unknown> } };
const parameters = (properties: Record<string, unknown>, required: string[]): Record<string, unknown> => ({
  type: "object", properties, required, additionalProperties: false,
});
const optional = (type: string, values?: string[]) => ({
  type: [type, "null"], ...(values ? { enum: [...values, null] } : {}), ...(!values && type === "string" ? { maxLength: 100 } : {}),
});

export const copilotTools: CopilotTool[] = [
  { type: "function", function: { name: "crm_analyze", strict: true, description: "Hitung atau kelompokkan data CRM yang boleh diakses pengguna. Gunakan untuk pertanyaan angka, peringkat, perbandingan, tren/periode, cabang, salesperson, produk, lead, pelanggan, peluang, aktivitas, atau stok. Pilih metrik dan pengelompokan yang sesuai, jangan menebak data. Untuk produk paling laku gunakan area sales dan groupBy product dengan metric units; omzet produk gunakan revenue. Semua output agregat, tanpa kontak pribadi.", parameters: parameters({
    area: { type: "string", enum: ["sales", "leads", "opportunities", "activities", "customers", "products"] },
    metric: { type: "string", enum: ["revenue", "transactions", "units", "count", "value", "weighted_value", "average_value", "stock"] },
    groupBy: { type: "string", enum: ["none", "branch", "salesperson", "product", "month", "status", "source", "stage", "type", "city", "segment", "brand", "category"] },
    period: { type: "string", enum: periods },
    branch: optional("string", Object.values(Branch)),
    status: optional("string", ["NEW", "CONTACTED", "QUALIFIED", "CONVERTED", "LOST", "PROSPECTING", "NEGOTIATION", "PROPOSAL", "WON", "ACTIVE", "INACTIVE", "PLANNED", "COMPLETED", "CANCELLED", "PENDING"]),
    limit: { type: "integer", minimum: 1, maximum: 10 },
  }, ["area", "metric", "groupBy", "period", "branch", "status", "limit"]) } },
  { type: "function", function: { name: "crm_search", strict: true, description: "Cari daftar terbatas record CRM berdasarkan nama/teks, status, cabang, dan periode. Gunakan untuk menampilkan record atau menjawab pertanyaan tentang pelanggan, kontak, lead, opportunity, aktivitas, transaksi, dan produk. Untuk katalog produk gunakan period all_time (periode, status, dan cabang tidak berlaku). Hanya kembalikan field yang aman dan record sesuai hak akses.", parameters: parameters({
    entity: { type: "string", enum: ["customers", "contacts", "leads", "opportunities", "activities", "transactions", "products"] },
    query: optional("string"),
    period: { type: "string", enum: periods },
    branch: optional("string", Object.values(Branch)),
    status: optional("string", ["NEW", "CONTACTED", "QUALIFIED", "CONVERTED", "LOST", "PROSPECTING", "NEGOTIATION", "PROPOSAL", "WON", "ACTIVE", "INACTIVE", "PLANNED", "COMPLETED", "CANCELLED", "PENDING"]),
    limit: { type: "integer", minimum: 1, maximum: 10 },
  }, ["entity", "query", "period", "branch", "status", "limit"]) } },
];

const enums: Record<string, readonly string[]> = {
  sales: Object.values(TransactionStatus), leads: Object.values(LeadStatus), opportunities: Object.values(OpportunityStage),
  activities: Object.values(ActivityStatus), customers: Object.values(CustomerStatus),
};
const unsupported = (message: string): never => { throw new HttpError(400, message); };
const numeric = (value: Prisma.Decimal | number | bigint | null | undefined) => Number(value ?? 0);

function dateRange(input: Period, now: Date) {
  const range = periodWindow(input, now);
  return range.start ? { gte: range.start, ...(range.end ? { lt: range.end } : {}) } : undefined;
}

function validateStatus(area: string, status?: string | null) {
  if (!status) return;
  if (status && !enums[area]?.includes(status)) unsupported(`Status ${status} tidak valid untuk data ${area}.`);
}

function validateGrouping(area: string, metric: AnalyzeInput["metric"], group: AnalyzeInput["groupBy"]) {
  const allowed: Record<AnalyzeInput["area"], string[]> = {
    sales: ["none", "branch", "salesperson", "product", "month"],
    leads: ["none", "status", "source", "branch", "salesperson"],
    opportunities: ["none", "stage", "branch", "salesperson"],
    activities: ["none", "status", "type", "branch", "salesperson"],
    customers: ["none", "status", "branch", "city", "segment", "salesperson"],
    products: ["none", "brand", "category"],
  };
  if (!allowed[inputArea(area)].includes(group)) unsupported(`Pengelompokan ${group} belum tersedia untuk data ${area}.`);
  const allowedMetrics: Record<AnalyzeInput["area"], string[]> = {
    sales: ["revenue", "transactions", "units", "average_value"],
    leads: ["count"], opportunities: ["count", "value", "weighted_value"],
    activities: ["count"], customers: ["count"], products: ["count", "stock"],
  };
  if (!allowedMetrics[inputArea(area)].includes(metric)) unsupported(`Metrik ${metric} belum tersedia untuk data ${area}.`);
  if (area === "sales" && metric === "units" && !["none", "product", "month"].includes(group)) {
    unsupported("Metrik unit sales saat ini hanya mendukung total, per produk, atau per bulan.");
  }
  if (area === "sales" && metric === "average_value" && group !== "none") unsupported("Rata-rata nilai transaksi saat ini hanya tersedia untuk total keseluruhan periode.");
  if (area === "products" && metric === "stock" && group !== "none") unsupported("Pengelompokan stok produk belum tersedia.");
  if (group === "month" && !["sales"].includes(area)) unsupported("Pengelompokan bulanan saat ini tersedia untuk data sales saja.");
  if (area === "sales" && group === "product" && !["revenue", "units"].includes(metric)) unsupported("Pengelompokan produk sales mendukung omzet atau jumlah unit.");
}
const inputArea = (area: string) => area as AnalyzeInput["area"];

function sourceFor(sources: Source[], resource: Source["resource"], id: string, label: string) {
  const existing = sources.find(item => item.resource === resource && item.id === id);
  if (existing) return existing.ref;
  const ref = `S${sources.length + 1}`;
  sources.push({ ref, resource, id, label: label.slice(0, 150) });
  return ref;
}

export async function executeCopilotTool(name: string, rawArguments: string, user: Principal, sources: Source[], now = new Date()): Promise<string> {
  let parsed: unknown;
  try { parsed = JSON.parse(rawArguments); } catch { return JSON.stringify({ error: "Tool arguments must be valid JSON." }); }
  try {
    if (name === "crm_analyze") return JSON.stringify(await analyze(analyzeSchema.parse(parsed), user, now));
    if (name === "crm_search") return JSON.stringify(await search(searchSchema.parse(parsed), user, sources, now));
    return JSON.stringify({ error: "Unknown CRM tool." });
  } catch (error) {
    if (error instanceof HttpError && error.status === 400) return JSON.stringify({ error: error.message, retryable: true });
    if (error instanceof ZodError) return JSON.stringify({ error: "Tool parameters are invalid.", details: error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`) });
    throw error;
  }
}

async function analyze(input: AnalyzeInput, user: Principal, now: Date) {
  validateStatus(input.area, input.status);
  validateGrouping(input.area, input.metric, input.groupBy);
  if (input.area === "products" && input.period !== "all_time") unsupported("Data produk/katalog tidak dibatasi periode; gunakan all_time. Untuk unit/omzet terjual gunakan area sales.");
  const window = periodWindow(input.period, now);
  const period = { label: window.label, timeZone: "Asia/Jakarta", ...(window.start ? { startInclusive: window.start.toISOString() } : {}), ...(window.end ? { endExclusive: window.end.toISOString() } : {}) };
  const filterBranch = input.branch ?? undefined;
  const limit = input.limit;
  if (input.area === "sales") {
    const metric = input.metric as "revenue" | "transactions" | "units" | "average_value";
    const where: Prisma.SalesTransactionWhereInput = {
      ...transactionScope(user), soldAt: dateRange(input.period, now), branch: filterBranch,
      status: (input.status as TransactionStatus | null | undefined) ?? (metric === "revenue" || metric === "units" || metric === "average_value" ? "COMPLETED" : undefined),
    };
    if (input.groupBy === "none") {
      const [sales, items] = await Promise.all([
        db.salesTransaction.aggregate({ where, _sum: { total: true }, _count: true }),
        metric === "units" ? db.salesTransactionItem.aggregate({ where: { transaction: where }, _sum: { quantity: true } }) : Promise.resolve(null),
      ]);
      const transactions = sales._count;
      const revenue = numeric(sales._sum.total);
      return { area: "sales", metric, groupBy: "none", period, filters: { branch: filterBranch ?? null, status: where.status ?? "ALL" },
        result: metric === "units" ? { units: numeric(items?._sum.quantity) } : metric === "average_value" ? { averageIDR: transactions ? revenue / transactions : 0, transactions } : metric === "transactions" ? { transactions } : { revenueIDR: revenue, transactions } };
    }
    if (input.groupBy === "product") {
      const grouped = await db.salesTransactionItem.groupBy({
        by: ["productId"], where: { transaction: where }, _sum: { quantity: true, subtotal: true },
        orderBy: metric === "units" ? [{ _sum: { quantity: "desc" } }, { productId: "asc" }] : [{ _sum: { subtotal: "desc" } }, { productId: "asc" }], take: limit,
      });
      const products = await db.product.findMany({ where: { id: { in: grouped.map(row => row.productId) } }, select: { id: true, name: true, brand: true } });
      return { area: "sales", metric, groupBy: "product", period, filters: { branch: filterBranch ?? null, status: where.status ?? "ALL" },
        rows: grouped.map(row => ({ product: products.find(product => product.id === row.productId)?.name ?? "Unknown", brand: products.find(product => product.id === row.productId)?.brand, units: numeric(row._sum.quantity), revenueIDR: numeric(row._sum.subtotal) })),
        limit, note: "Top rows are ordered by the requested metric; only completed sales when status omitted. Quantities are recorded item quantities." };
    }
    if (input.groupBy === "month") {
      const grouped = await db.salesTransaction.findMany({ where, select: { soldAt: true, total: true, items: { select: { quantity: true } } }, take: 10000 });
      if (grouped.length === 10000) unsupported("Rentang terlalu besar untuk rincian bulanan; pilih periode lebih pendek.");
      const months = new Map<string, { transactions: number; revenueIDR: number; units: number }>();
      for (const row of grouped) {
        const key = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", timeZone: "Asia/Jakarta" }).format(row.soldAt);
        const value = months.get(key) ?? { transactions: 0, revenueIDR: 0, units: 0 };
        value.transactions++; value.revenueIDR += numeric(row.total); value.units += row.items.reduce((sum, item) => sum + item.quantity, 0); months.set(key, value);
      }
      return { area: "sales", metric, groupBy: "month", period, rows: [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, values]) => ({ month, ...values })) };
    }
    if (input.groupBy === "salesperson") {
      const grouped = await db.salesTransaction.groupBy({ by: ["salespersonId"], where, _sum: { total: true }, _count: true, orderBy: [{ _sum: { total: "desc" } }, { salespersonId: "asc" }], take: limit });
      const sellers = await db.user.findMany({ where: { id: { in: grouped.map(row => row.salespersonId) } }, select: { id: true, name: true } });
      return { area: "sales", metric, groupBy: input.groupBy, period, filters: { branch: filterBranch ?? null, status: where.status ?? "ALL" },
        rows: grouped.map(row => ({ label: sellers.find(seller => seller.id === row.salespersonId)?.name ?? "Unknown", revenueIDR: numeric(row._sum.total), transactions: row._count })) };
    }
    const grouped = await db.salesTransaction.groupBy({ by: ["branch"], where, _sum: { total: true }, _count: true, orderBy: [{ _sum: { total: "desc" } }, { branch: "asc" }], take: limit });
    return { area: "sales", metric, groupBy: input.groupBy, period, filters: { branch: filterBranch ?? null, status: where.status ?? "ALL" },
      rows: grouped.map(row => ({ label: row.branch ?? "Tanpa cabang", revenueIDR: numeric(row._sum.total), transactions: row._count })) };
  }

  if (input.area === "leads") {
    const where: Prisma.LeadWhereInput = { AND: [leadScope(user), { createdAt: dateRange(input.period, now) }, { branch: filterBranch }, { status: (input.status ?? undefined) as LeadStatus | undefined }] };
    if (input.groupBy === "none") return { area: "leads", metric: "count", groupBy: "none", period, filters: { branch: filterBranch ?? null, status: input.status ?? "ALL" }, result: { count: await db.lead.count({ where }) } };
    const field = input.groupBy === "source" ? "source" : input.groupBy === "status" ? "status" : input.groupBy === "salesperson" ? "ownerId" : "branch";
    const orderBy = { _count: { id: "desc" as const } };
    const grouped = field === "source" ? await db.lead.groupBy({ by: ["source"], where, _count: true, orderBy: [orderBy, { source: "asc" }], take: limit })
      : field === "status" ? await db.lead.groupBy({ by: ["status"], where, _count: true, orderBy: [orderBy, { status: "asc" }], take: limit })
      : field === "ownerId" ? await db.lead.groupBy({ by: ["ownerId"], where, _count: true, orderBy: [orderBy, { ownerId: "asc" }], take: limit })
      : field === "branch" ? await db.lead.groupBy({ by: ["branch"], where, _count: true, orderBy: [orderBy, { branch: "asc" }], take: limit })
      : [];
    const sellerIds = grouped.flatMap(row => "ownerId" in row ? [row.ownerId] : []);
    const sellers = sellerIds.length ? await db.user.findMany({ where: { id: { in: sellerIds } }, select: { id: true, name: true } }) : [];
    return { area: "leads", metric: "count", groupBy: input.groupBy, period, rows: grouped.map(row => ({ label: "ownerId" in row ? sellers.find(seller => seller.id === row.ownerId)?.name : ("source" in row ? row.source : "status" in row ? row.status : row.branch) ?? "Tidak diketahui", count: row._count })) };
  }

  if (input.area === "opportunities") {
    const where: Prisma.OpportunityWhereInput = { AND: [opportunityScope(user), { createdAt: dateRange(input.period, now) }, { branch: filterBranch }, { stage: (input.status ?? undefined) as OpportunityStage | undefined }] };
    if (input.groupBy === "none") {
      if (input.metric === "weighted_value") {
        const rows = await db.opportunity.findMany({ where, select: { value: true, probability: true }, take: 10001 });
        if (rows.length === 10001) unsupported("Rentang terlalu besar untuk menghitung pipeline tertimbang; pilih periode lebih pendek.");
        return { area: "opportunities", metric: input.metric, groupBy: "none", period, result: { weightedValueIDR: rows.reduce((sum, row) => sum + numeric(row.value) * row.probability / 100, 0), opportunities: rows.length } };
      }
      const row = await db.opportunity.aggregate({ where, _sum: { value: true }, _count: true });
      return { area: "opportunities", metric: input.metric, groupBy: "none", period, result: input.metric === "count" ? { count: row._count } : { valueIDR: numeric(row._sum.value), opportunities: row._count } };
    }
    if (input.metric === "weighted_value") {
      const grouped = await db.opportunity.findMany({ where, select: { stage: true, branch: true, ownerId: true, value: true, probability: true }, take: 10001 });
      const values = new Map<string, { weightedValueIDR: number; opportunities: number }>();
      if (grouped.length === 10001) unsupported("Rentang terlalu besar untuk menghitung pipeline tertimbang; pilih periode lebih pendek.");
      for (const row of grouped) { const label = input.groupBy === "stage" ? row.stage : input.groupBy === "branch" ? row.branch ?? "Tanpa cabang" : row.ownerId; const entry = values.get(label) ?? { weightedValueIDR: 0, opportunities: 0 }; entry.weightedValueIDR += numeric(row.value) * Number(row.probability) / 100; entry.opportunities++; values.set(label, entry); }
      const ranked = [...values.entries()].sort((a, b) => b[1].weightedValueIDR - a[1].weightedValueIDR).slice(0, limit);
      const sellers = input.groupBy === "salesperson" ? await db.user.findMany({ where: { id: { in: ranked.map(([ownerId]) => ownerId) } }, select: { id: true, name: true } }) : [];
      return { area: "opportunities", metric: input.metric, groupBy: input.groupBy, period, rows: ranked.map(([key, values]) => ({ label: input.groupBy === "salesperson" ? sellers.find(seller => seller.id === key)?.name ?? "Unknown" : key, ...values })) };
    }
    if (input.groupBy === "stage") {
      const grouped = await db.opportunity.groupBy({ by: ["stage"], where, _sum: { value: true }, _count: true, orderBy: [{ _sum: { value: "desc" } }, { stage: "asc" }], take: limit });
      return { area: "opportunities", metric: input.metric, groupBy: input.groupBy, period, rows: grouped.map(row => ({ label: row.stage, count: row._count, valueIDR: numeric(row._sum.value) })) };
    }
    if (input.groupBy === "salesperson") {
      const grouped = await db.opportunity.groupBy({ by: ["ownerId"], where, _sum: { value: true }, _count: true, orderBy: [{ _sum: { value: "desc" } }, { ownerId: "asc" }], take: limit });
      const sellers = await db.user.findMany({ where: { id: { in: grouped.map(row => row.ownerId) } }, select: { id: true, name: true } });
      return { area: "opportunities", metric: input.metric, groupBy: input.groupBy, period, rows: grouped.map(row => ({ label: sellers.find(seller => seller.id === row.ownerId)?.name ?? "Unknown", count: row._count, valueIDR: numeric(row._sum.value) })) };
    }
    const grouped = await db.opportunity.groupBy({ by: ["branch"], where, _sum: { value: true }, _count: true, orderBy: [{ _sum: { value: "desc" } }, { branch: "asc" }], take: limit });
    return { area: "opportunities", metric: input.metric, groupBy: input.groupBy, period, rows: grouped.map(row => ({ label: row.branch ?? "Tanpa cabang", count: row._count, valueIDR: numeric(row._sum.value) })) };
  }

  if (input.area === "activities") {
    const where: Prisma.ActivityWhereInput = { AND: [activityScope(user), { dueAt: dateRange(input.period, now) }, { branch: filterBranch }, { status: (input.status ?? undefined) as ActivityStatus | undefined }] };
    if (input.groupBy === "none") return { area: "activities", metric: "count", groupBy: "none", period, filters: { branch: filterBranch ?? null, status: input.status ?? "ALL" }, result: { count: await db.activity.count({ where }) } };
    const field = input.groupBy === "type" ? "type" : input.groupBy === "status" ? "status" : input.groupBy === "salesperson" ? "ownerId" : "branch";
    const orderBy = { _count: { id: "desc" as const } };
    const grouped = field === "type" ? await db.activity.groupBy({ by: ["type"], where, _count: true, orderBy: [orderBy, { type: "asc" }], take: limit })
      : field === "status" ? await db.activity.groupBy({ by: ["status"], where, _count: true, orderBy: [orderBy, { status: "asc" }], take: limit })
      : field === "ownerId" ? await db.activity.groupBy({ by: ["ownerId"], where, _count: true, orderBy: [orderBy, { ownerId: "asc" }], take: limit })
      : await db.activity.groupBy({ by: ["branch"], where, _count: true, orderBy: [orderBy, { branch: "asc" }], take: limit });
    const sellerIds = grouped.flatMap(row => "ownerId" in row ? [row.ownerId] : []);
    const sellers = sellerIds.length ? await db.user.findMany({ where: { id: { in: sellerIds } }, select: { id: true, name: true } }) : [];
    return { area: "activities", metric: "count", groupBy: input.groupBy, period, rows: grouped.map(row => ({ label: "ownerId" in row ? sellers.find(seller => seller.id === row.ownerId)?.name : ("type" in row ? row.type : "status" in row ? row.status : row.branch) ?? "Tidak diketahui", count: row._count })) };
  }

  if (input.area === "customers") {
    const where: Prisma.CustomerWhereInput = { AND: [customerScope(user), { createdAt: dateRange(input.period, now) }, { branch: filterBranch }, { status: (input.status ?? undefined) as CustomerStatus | undefined }] };
    if (input.groupBy === "none") return { area: "customers", metric: "count", groupBy: "none", period, filters: { branch: filterBranch ?? null, status: input.status ?? "ALL" }, result: { count: await db.customer.count({ where }) } };
    const field = input.groupBy === "status" ? "status" : input.groupBy === "branch" ? "branch" : input.groupBy === "city" ? "city" : input.groupBy === "segment" ? "segment" : "ownerId";
    const orderBy = { _count: { id: "desc" as const } };
    const grouped = field === "status" ? await db.customer.groupBy({ by: ["status"], where, _count: true, orderBy: [orderBy, { status: "asc" }], take: limit })
      : field === "branch" ? await db.customer.groupBy({ by: ["branch"], where, _count: true, orderBy: [orderBy, { branch: "asc" }], take: limit })
      : field === "city" ? await db.customer.groupBy({ by: ["city"], where, _count: true, orderBy: [orderBy, { city: "asc" }], take: limit })
      : field === "segment" ? await db.customer.groupBy({ by: ["segment"], where, _count: true, orderBy: [orderBy, { segment: "asc" }], take: limit })
      : await db.customer.groupBy({ by: ["ownerId"], where, _count: true, orderBy: [orderBy, { ownerId: "asc" }], take: limit });
    const sellerIds = grouped.flatMap(row => "ownerId" in row ? [row.ownerId] : []);
    const sellers = sellerIds.length ? await db.user.findMany({ where: { id: { in: sellerIds } }, select: { id: true, name: true } }) : [];
    return { area: "customers", metric: "count", groupBy: input.groupBy, period, rows: grouped.map(row => ({ label: "ownerId" in row ? sellers.find(seller => seller.id === row.ownerId)?.name : ("status" in row ? row.status : "branch" in row ? row.branch : "city" in row ? row.city : row.segment) ?? "Tidak diketahui", count: row._count })) };
  }

  const where: Prisma.ProductWhereInput = { active: true };
  if (input.groupBy === "none") {
    const [count, stock] = await Promise.all([db.product.count({ where }), db.product.aggregate({ where, _sum: { stock: true } })]);
    return { area: "products", metric: input.metric, groupBy: "none", period, result: input.metric === "stock" ? { stock: numeric(stock._sum.stock), products: count } : { count } };
  }
  const grouped = input.groupBy === "brand"
    ? await db.product.groupBy({ by: ["brand"], where, _count: true, orderBy: [{ _count: { id: "desc" } }, { brand: "asc" }], take: limit })
    : await db.product.groupBy({ by: ["category"], where, _count: true, orderBy: [{ _count: { id: "desc" } }, { category: "asc" }], take: limit });
  return { area: "products", metric: "count", groupBy: input.groupBy, period, rows: grouped.map(row => ({ label: "brand" in row ? row.brand : row.category, count: row._count })) };
}

async function search(input: z.infer<typeof searchSchema>, user: Principal, sources: Source[], now: Date) {
  if (input.entity === "contacts" && input.status) unsupported("Filter status belum tersedia untuk pencarian kontak.");
  if (input.entity === "products" && input.status) unsupported("Filter status belum tersedia untuk pencarian produk.");
  if (input.entity === "products" && input.branch) unsupported("Filter cabang belum tersedia untuk pencarian katalog produk.");
  if (input.entity === "products" && input.period !== "all_time") unsupported("Katalog produk tidak dibatasi periode; gunakan all_time.");
  const window = periodWindow(input.period, now);
  const range = window.start ? { gte: window.start, ...(window.end ? { lt: window.end } : {}) } : undefined;
  const query = input.query;
  const name = { contains: query, mode: "insensitive" as const };
  const branch = input.branch;
  const take = input.limit;
  const rows: { id: string; name: string; resource: Source["resource"]; data: Record<string, unknown> }[] = [];
  if (input.entity === "customers") {
    const status = input.status as CustomerStatus | undefined; validateStatus("customers", input.status);
    const found = await db.customer.findMany({ where: { AND: [customerScope(user), { OR: [{ name }, { city: name }, { segment: name }] }, { branch }, { status }, { createdAt: range }] }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take, select: { id: true, name: true, city: true, segment: true, status: true, branch: true, updatedAt: true } });
    rows.push(...found.map(({ id, name, ...data }) => ({ id, name, resource: "customers" as const, data })));
  } else if (input.entity === "contacts") {
    const found = await db.contact.findMany({ where: { AND: [contactScope(user), { OR: [{ name }, { title: name }, { customer: { name } }] }, { customer: { branch } }, { createdAt: range }] }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take, select: { id: true, name: true, title: true, customer: { select: { name: true } }, createdAt: true } });
    rows.push(...found.map(({ id, name, ...data }) => ({ id, name, resource: "contacts" as const, data })));
  } else if (input.entity === "leads") {
    const status = input.status as LeadStatus | undefined; validateStatus("leads", input.status);
    const found = await db.lead.findMany({ where: { AND: [leadScope(user), { OR: [{ name }, { interest: name }] }, { branch }, { status }, { createdAt: range }] }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take, select: { id: true, name: true, source: true, status: true, interest: true, branch: true, createdAt: true } });
    rows.push(...found.map(({ id, name, ...data }) => ({ id, name, resource: "leads" as const, data })));
  } else if (input.entity === "opportunities") {
    const status = input.status as OpportunityStage | undefined; validateStatus("opportunities", input.status);
    const found = await db.opportunity.findMany({ where: { AND: [opportunityScope(user), { OR: [{ name }, { customer: { name } }] }, { branch }, { stage: status }, { createdAt: range }] }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take, select: { id: true, name: true, stage: true, value: true, probability: true, expectedCloseDate: true, branch: true, customer: { select: { name: true } }, createdAt: true } });
    rows.push(...found.map(({ id, name, ...data }) => ({ id, name, resource: "opportunities" as const, data })));
  } else if (input.entity === "activities") {
    const status = input.status as ActivityStatus | undefined; validateStatus("activities", input.status);
    const found = await db.activity.findMany({ where: { AND: [activityScope(user), { OR: [{ subject: name }, { customer: { name } }, { opportunity: { name } }] }, { branch }, { status }, { dueAt: range }] }, orderBy: [{ dueAt: "asc" }, { id: "asc" }], take, select: { id: true, subject: true, type: true, status: true, dueAt: true, branch: true, customer: { select: { name: true } }, opportunity: { select: { name: true } } } });
    rows.push(...found.map(({ id, subject, ...data }) => ({ id, name: subject, resource: "activities" as const, data })));
  } else if (input.entity === "transactions") {
    const status = input.status as TransactionStatus | undefined; validateStatus("sales", input.status);
    const found = await db.salesTransaction.findMany({ where: { AND: [transactionScope(user), { OR: [{ invoice: name }, { customer: { name } }, { salesperson: { name } }] }, { branch }, { status }, { soldAt: range }] }, orderBy: [{ soldAt: "desc" }, { id: "asc" }], take, select: { id: true, invoice: true, status: true, total: true, branch: true, soldAt: true, customer: { select: { name: true } }, salesperson: { select: { name: true } }, items: { select: { quantity: true, product: { select: { name: true } } } } } });
    rows.push(...found.map(({ id, invoice, ...data }) => ({ id, name: invoice, resource: "transactions" as const, data })));
  } else {
    const found = await db.product.findMany({ where: { active: true, OR: [{ name }, { brand: name }, { category: name }, { sku: name }] }, orderBy: [{ name: "asc" }, { id: "asc" }], take, select: { id: true, name: true, brand: true, category: true, price: true, stock: true } });
    rows.push(...found.map(({ id, name, ...data }) => ({ id, name, resource: "products" as const, data })));
  }
  const records = rows.map(row => ({ ref: sourceFor(sources, row.resource, row.id, row.name), name: row.name, ...row.data }));
  return { entity: input.entity, query, period: window.label, returned: records.length, limit: take, sourceRefs: records.map(record => record.ref), filters: { branch: branch ?? null, status: input.status ?? "ALL" }, records, note: "Only permitted records and explicitly selected safe fields. An empty result means no matching visible records; do not infer absent offline activity." };
}
