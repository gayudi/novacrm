import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { leadScope, opportunityScope, transactionScope } from "./access.js";
import { HttpError, type Principal } from "./http.js";
import { monthStart } from "./dashboard.js";
import { isSalespersonQuestion } from "./copilot-sales.js";

export const visualRequestSchema = z.object({
  type: z.enum(["bar", "line", "pie", "flow"]),
  metric: z.enum(["revenue_monthly", "leads_monthly", "lead_sources", "lead_statuses", "sales_branch", "top_products", "pipeline_stages", "sales_process"]),
}).strict().refine(value => (value.type === "flow") === (value.metric === "sales_process"), {
  message: "Diagram alur hanya tersedia untuk proses penjualan. Pilih batang, garis, atau lingkaran untuk grafik data.",
});
export type VisualRequest = z.infer<typeof visualRequestSchema>;
export type CopilotVisual = VisualRequest & {
  title: string; description: string; unit: "IDR" | "lead" | "peluang";
  points: { label: string; value: number }[];
};

const visualIntent = /\b(grafik|diagram|bagan|chart|graph|flowchart|visualisasi)\b/i;
export function resolveVisualRequest(input: { action: string; prompt: string; recordId?: string; visualization?: VisualRequest }): VisualRequest | undefined {
  const prompt = input.prompt;
  if (!visualIntent.test(prompt) && input.action !== "visualization") return undefined;
  if (isSalespersonQuestion(prompt)) throw new HttpError(400, "Peringkat sales tersedia sebagai tabel, belum sebagai grafik per salesperson. Pilih Peringkat sales atau tanyakan siapa sales dengan omzet tertinggi bulan ini.");
  if (input.recordId) throw new HttpError(400, "Untuk grafik, pilih tugas Grafik dan diagram tanpa memilih data individual.");
  if (input.action === "visualization" && input.visualization) return input.visualization;
  if (/\b(alur|flowchart|flow|proses|process)\b/i.test(prompt)) {
    if (!/\b(penjualan|sales|peluang|opportunit(?:y|ies)|pipeline)\b/i.test(prompt)) {
      throw new HttpError(400, "Diagram alur yang tersedia adalah proses penjualan. Contoh: buatkan diagram alur proses penjualan.");
    }
    return { type: "flow", metric: "sales_process" };
  }
  let metric: VisualRequest["metric"] | undefined;
  if (/\b(lead|leads|prospek)\b/i.test(prompt)) {
    if (/\b(sumber|source|sources|asal)\b/i.test(prompt)) metric = "lead_sources";
    else if (/\b(status|statuses)\b/i.test(prompt)) metric = "lead_statuses";
    else if (/\b(tren|trend|bulanan|bulan|monthly|month|waktu)\b/i.test(prompt)) metric = "leads_monthly";
  } else if (/\b(produk|products?)\b/i.test(prompt)) metric = "top_products";
  else if (/\b(cabang|branches|branch)\b/i.test(prompt)) metric = "sales_branch";
  else if (/\b(pipeline|peluang|opportunit(?:y|ies))\b/i.test(prompt)) metric = "pipeline_stages";
  else if (/\b(pendapatan|penjualan|revenue|sales|omzet)\b/i.test(prompt)) metric = "revenue_monthly";
  if (!metric) throw new HttpError(400, "Pilih topik grafik: tren pendapatan atau lead, sumber/status lead, penjualan per cabang, produk terlaris, atau tahapan peluang. Contoh: buat grafik garis pendapatan.");
  const type = /\b(lingkaran|pie|donat|donut)\b/i.test(prompt) ? "pie"
    : /\b(garis|line)\b/i.test(prompt) ? "line"
    : /\b(batang|bar)\b/i.test(prompt) ? "bar"
    : metric.endsWith("_monthly") ? "line" : "bar";
  return { type, metric };
}

const labels: Record<string, string> = {
  WALK_IN: "Datang ke toko", WEBSITE: "Situs web", SOCIAL_MEDIA: "Media sosial", REFERRAL: "Referensi",
  MARKETPLACE: "Lokapasar", EVENT: "Acara", INSTAGRAM: "Instagram", FACEBOOK: "Facebook", TIKTOK: "TikTok",
  NEW: "Baru", CONTACTED: "Sudah dihubungi", QUALIFIED: "Terkualifikasi", CONVERTED: "Dikonversi", LOST: "Kalah",
  PROSPECTING: "Pencarian prospek", QUALIFICATION: "Kualifikasi", NEEDS_ANALYSIS: "Analisis kebutuhan",
  PROPOSAL: "Penawaran", NEGOTIATION: "Negosiasi", WON: "Menang",
  CALL: "Telepon", EMAIL: "Email", WHATSAPP: "WhatsApp", MEETING: "Pertemuan",
  STORE_VISIT: "Kunjungan toko", FOLLOW_UP: "Tindak lanjut", TASK: "Tugas",
  JAKARTA: "Jakarta", BANDUNG: "Bandung", SURABAYA: "Surabaya", MEDAN: "Medan", SEMARANG: "Semarang",
};
const stages = ["PROSPECTING", "QUALIFIED", "QUALIFICATION", "NEEDS_ANALYSIS", "PROPOSAL", "NEGOTIATION", "WON", "LOST"] as const;
export const crmLabel = (key: string | null) => key === null ? "Tanpa cabang" : labels[key] ?? key;

export async function retrieveVisual(tx: Prisma.TransactionClient, user: Principal, request: VisualRequest, now: Date): Promise<CopilotVisual> {
  const base = { ...request };
  const allTime = "Seluruh waktu hingga saat kueri; hanya data sesuai hak akses. Tidak menerapkan filter tambahan dari teks pertanyaan.";
  const monthlyPeriod = `Bulan berjalan dan dua bulan sebelumnya, batas kalender UTC. Bulan berjalan belum penuh. Hingga ${now.toISOString()}.`;
  const currentPeriod = `Bulan berjalan, ${monthStart(now).toISOString()} sampai ${now.toISOString()} (UTC); hanya transaksi selesai.`;
  const salesWhere = { ...transactionScope(user), status: "COMPLETED" as const, soldAt: { gte: monthStart(now), lte: now } };
  switch (request.metric) {
    case "revenue_monthly":
    case "leads_monthly": {
      const points = await Promise.all([-2, -1, 0].map(async offset => {
        const start = monthStart(now, offset);
        const end = offset === 0 ? now : monthStart(now, offset + 1);
        const range = offset === 0 ? { gte: start, lte: end } : { gte: start, lt: end };
        const value = request.metric === "leads_monthly"
          ? await tx.lead.count({ where: { ...leadScope(user), createdAt: range } })
          : Number((await tx.salesTransaction.aggregate({ where: { ...transactionScope(user), status: "COMPLETED", soldAt: range }, _sum: { total: true } }))._sum.total ?? 0);
        return { label: new Intl.DateTimeFormat("id-ID", { month: "short", year: "numeric", timeZone: "UTC" }).format(start), value };
      }));
      return { ...base, title: request.metric === "revenue_monthly" ? "Tren pendapatan" : "Tren lead baru", unit: request.metric === "revenue_monthly" ? "IDR" : "lead", description: monthlyPeriod, points };
    }
    case "lead_sources":
    case "lead_statuses": {
      const where = { ...leadScope(user), createdAt: { lte: now } };
      const points = request.metric === "lead_sources"
        ? (await tx.lead.groupBy({ by: ["source"], where, _count: true, orderBy: { source: "asc" } })).map(row => ({ label: crmLabel(row.source), value: row._count }))
        : (await tx.lead.groupBy({ by: ["status"], where, _count: true, orderBy: { status: "asc" } })).map(row => ({ label: crmLabel(row.status), value: row._count }));
      return { ...base, title: request.metric === "lead_sources" ? "Sumber lead" : "Status lead", unit: "lead", description: allTime, points };
    }
    case "sales_branch": {
      const rows = await tx.salesTransaction.groupBy({ by: ["branch"], where: salesWhere, _sum: { total: true }, orderBy: { branch: "asc" } });
      return { ...base, title: "Pendapatan per cabang", unit: "IDR", description: currentPeriod, points: rows.map(row => ({ label: crmLabel(row.branch), value: Number(row._sum.total ?? 0) })) };
    }
    case "top_products": {
      const rows = await tx.salesTransactionItem.groupBy({
        by: ["productId"], where: { transaction: salesWhere }, _sum: { subtotal: true },
        orderBy: [{ _sum: { subtotal: "desc" } }, { productId: "asc" }], take: 5,
      });
      const products = await tx.product.findMany({ where: { id: { in: rows.map(row => row.productId) } }, select: { id: true, name: true } });
      return {
        ...base, title: "Lima produk teratas menurut pendapatan", unit: "IDR",
        description: `${currentPeriod} Maksimal lima produk, bukan keseluruhan katalog.`,
        points: rows.map(row => ({ label: products.find(product => product.id === row.productId)!.name.slice(0, 100), value: Number(row._sum.subtotal ?? 0) })),
      };
    }
    case "pipeline_stages":
    case "sales_process": {
      const rows = await tx.opportunity.groupBy({ by: ["stage"], where: { ...opportunityScope(user), createdAt: { lte: now } }, _count: true });
      const points = stages.map(stage => ({ label: crmLabel(stage), value: rows.find(row => row.stage === stage)?._count ?? 0 }));
      if (request.metric === "sales_process") {
        const qualified = (rows.find(row => row.stage === "QUALIFIED")?._count ?? 0) + (rows.find(row => row.stage === "QUALIFICATION")?._count ?? 0);
        return {
          ...base, title: "Alur proses penjualan", unit: "peluang",
          description: `Contoh alur, bukan riwayat perpindahan atau tingkat konversi. Angka menunjukkan jumlah peluang yang saat ini berada di tiap tahap. Kualifikasi menggabungkan QUALIFIED dan QUALIFICATION. ${allTime}`,
          points: [points[0]!, { label: "Kualifikasi", value: qualified }, ...points.slice(3)],
        };
      }
      return { ...base, title: "Jumlah peluang per tahap", unit: "peluang", description: allTime, points };
    }
  }
}
