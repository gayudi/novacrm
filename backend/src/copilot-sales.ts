import { Prisma } from "@prisma/client";
import { transactionScopeSql } from "./access.js";
import { HttpError, type Principal } from "./http.js";
import { transactionPeriod } from "./transactions.js";

export function isSalespersonQuestion(prompt: string): boolean {
  const person = /\b(salesperson|salespeople|salesman|saleswoman|sales\s+(?:rep|representative)|tenaga penjualan|staf penjualan)\b/i;
  const salesRanking = /\b(?:top\s*(?:\d+\s*)?sales|(?:peringkat|ranking|kinerja|performa|per)\s+(?:para\s+)?sales|sales\s+(?:mana|siapa|terbaik|teratas|tertinggi|terbanyak|paling|palinb|dengan|yang))\b/i;
  const whoSells = /\bsiapa\b/i.test(prompt) && /\b(sales|jualan|menjual|penjualan)\b/i.test(prompt);
  const ranking = /\b(top|best|highest|most|ranking|rank|leaderboard|peringkat|teratas|tertinggi|terbanyak|terbaik|paling|palinb|banyak|kinerja|performa|siapa|who|per|by|compare|bandingkan)\b/i;
  return (person.test(prompt) && ranking.test(prompt)) || salesRanking.test(prompt) || whoSells;
}

export function salesRankingRequest(prompt: string) {
  if (/\b(minggu|pekan|week|kuartal|quart[ae]l|quarter|tahun|year|lalu|kemarin|last|previous|yesterday|januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember|january|february|march|may|june|july|august|october|december|20\d{2})\b|\b(?:semua|seluruh|sepanjang)\s+waktu\b|\ball[\s-]+time\b|\d{1,2}[/-]\d{1,2}/i.test(prompt)) {
    throw new HttpError(400, "Peringkat sales saat ini tersedia untuk bulan berjalan sampai saat kueri dalam WIB. Periode lain belum didukung; jangan gunakan hasil bulan ini sebagai jawaban untuk periode lain.");
  }
  if (/\b(cabang|kota|branch|jakarta|bandung|surabaya|medan|semarang|produk|products?|iphone|samsung|xiaomi|oppo|vivo|realme|infinix)\b/i.test(prompt)) {
    throw new HttpError(400, "Peringkat sales saat ini belum mendukung filter cabang atau produk. Gunakan pertanyaan tanpa filter tersebut, atau periksa transaksi dengan filter di halaman Sales transactions.");
  }
  const explicitBasis = /\b(?:berdasarkan|menurut|by)\s+(?:jumlah\s+|total\s+)?(omzet|pendapatan|revenue|transaksi|transactions?|unit|units)\b/i.exec(prompt)?.[1]?.toLowerCase();
  const hasRevenue = /\b(omzet|omset|pendapatan|revenue|rupiah)\b/i.test(prompt);
  const metric = explicitBasis
    ? /transa/.test(explicitBasis) ? "transactions" : /unit/.test(explicitBasis) ? "units" : "revenue"
    : !hasRevenue && /\b(unit|units|pcs|kuantitas|quantity)\b/i.test(prompt) ? "units"
    : !hasRevenue && /\b(transaksi|transactions?|invoice|nota)\b/i.test(prompt) ? "transactions"
    : "revenue";
  const requestedLimit = /\b(?:top|peringkat)\s*(\d+)\b|\b(\d+)\s+(?:orang\s+)?sales\b/i.exec(prompt);
  const limit = requestedLimit ? Number(requestedLimit[1] ?? requestedLimit[2]) : 5;
  if (limit < 1 || limit > 10) throw new HttpError(400, "Peringkat sales mendukung 1 sampai 10 nama per pertanyaan.");
  return { metric, limit } as const;
}
type RankingRequest = ReturnType<typeof salesRankingRequest>;
export type SalesRanking = RankingRequest & {
  scope: "own" | "company"; start: string; asOf: string; totalSalespeople: number;
  missingItemTransactions: number;
  rows: { name: string; rank: number; revenueIDR: number; transactions: number; units: number }[];
};

export async function retrieveSalesRanking(tx: Prisma.TransactionClient, user: Principal, request: RankingRequest, now: Date): Promise<SalesRanking> {
  const start = transactionPeriod("month", now)!.gte;
  const metric = request.metric === "units" ? Prisma.sql`units` : request.metric === "transactions" ? Prisma.sql`transactions` : Prisma.sql`revenue`;
  const rows = await tx.$queryRaw<{
    salespersonId: string; revenue: Prisma.Decimal; transactions: bigint; units: bigint;
    rank: bigint; totalSalespeople: bigint; missingItemTransactions: Prisma.Decimal;
  }[]>`
    WITH eligible AS (
      SELECT id, "salespersonId", total FROM sales_transactions
      WHERE status = 'COMPLETED'
        AND "soldAt" >= (${start} AT TIME ZONE 'UTC') AND "soldAt" <= (${now} AT TIME ZONE 'UTC')
      ${transactionScopeSql(user)}
    ), totals AS (
      SELECT s."salespersonId", sum(s.total) AS revenue, count(*) AS transactions,
        sum(coalesce(i.units, 0)) AS units,
        count(*) FILTER (WHERE i.items = 0) AS missing
      FROM eligible s
      LEFT JOIN LATERAL (
        SELECT sum(quantity) AS units, count(*) AS items FROM sales_transaction_items WHERE "transactionId" = s.id
      ) i ON true
      GROUP BY s."salespersonId"
    )
    SELECT *, rank() OVER (ORDER BY ${metric} DESC) AS rank,
      count(*) OVER () AS "totalSalespeople", sum(missing) OVER () AS "missingItemTransactions"
    FROM totals ORDER BY ${metric} DESC, "salespersonId" ASC LIMIT ${request.limit}`;
  const people = await tx.user.findMany({ where: { id: { in: rows.map(row => row.salespersonId) } }, select: { id: true, name: true } });
  return {
    ...request, scope: user.role === "SALES" ? "own" : "company",
    start: start.toISOString(), asOf: now.toISOString(),
    totalSalespeople: Number(rows[0]?.totalSalespeople ?? 0),
    missingItemTransactions: Number(rows[0]?.missingItemTransactions ?? 0),
    rows: rows.map(row => ({
      name: people.find(person => person.id === row.salespersonId)!.name.slice(0, 150),
      rank: Number(row.rank), revenueIDR: Number(row.revenue), transactions: Number(row.transactions), units: Number(row.units),
    })),
  };
}

const escapeMarkdown = (value: string) => value.replace(/[\r\n]/g, " ").replace(/[\\`*_{}[\]()#+.!|>~-]/g, "\\$&").replace(/</g, "&lt;");
export function salesRankingAnswer(result: SalesRanking): string {
  const clock = new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Jakarta" });
  const rupiah = (value: number) => `Rp${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(value)}`;
  const metricLabel = result.metric === "revenue" ? "omzet transaksi selesai" : result.metric === "transactions" ? "jumlah transaksi selesai" : "jumlah unit tercatat";
  const lines = [
    result.scope === "own" ? "## Kinerja penjualan Anda bulan ini" : `## Peringkat sales berdasarkan ${metricLabel}`,
    `Periode: **${clock.format(new Date(result.start))} WIB** sampai **${clock.format(new Date(result.asOf))} WIB** (bulan berjalan, belum penuh).`,
    `Dasar urutan: **${metricLabel}**. Hanya transaksi berstatus **Selesai (COMPLETED)**; pending dan batal tidak dihitung.`,
  ];
  if (result.scope === "own") lines.push("**Hanya data penjualan yang boleh Anda akses.** Hasil ini bukan peringkat seluruh perusahaan; Anda tidak dapat membandingkan dengan sales lain.");
  if (!result.rows.length) {
    lines.push("Belum ada transaksi selesai pada periode dan cakupan akses ini. Tidak ada sales teratas yang dapat ditentukan.");
    return lines.join("\n\n");
  }
  const winner = result.rows[0]!;
  if (result.scope === "company") {
    const value = result.metric === "revenue" ? rupiah(winner.revenueIDR) : result.metric === "transactions" ? `${winner.transactions} transaksi` : `${winner.units} unit tercatat`;
    lines.push(`**${escapeMarkdown(winner.name)}** berada pada peringkat **1** berdasarkan ${metricLabel}, dengan **${value}**.`);
  }
  lines.push([
    "| Peringkat | Nama sales | Omzet | Transaksi selesai | Unit tercatat |",
    "| --- | --- | ---: | ---: | ---: |",
    ...result.rows.map(row => `| ${result.scope === "own" ? "—" : row.rank} | ${escapeMarkdown(row.name)} | ${rupiah(row.revenueIDR)} | ${row.transactions} | ${row.units} |`),
  ].join("\n"));
  if (result.scope === "company") lines.push(`Menampilkan ${result.rows.length} dari ${result.totalSalespeople} sales dengan transaksi selesai, maksimal ${result.limit} nama. Nilai yang sama berbagi peringkat; urutan tampilan saat seri tidak menunjukkan keunggulan.`);
  if (result.missingItemTransactions) lines.push(`**Keterbatasan rincian:** ${result.missingItemTransactions} transaksi pada cakupan ini tidak memiliki item. Jumlah unit hanya mencakup item yang tercatat, bukan perkiraan.`);
  lines.push("Angka dihitung langsung dari database CRM, bukan perkiraan AI. Tidak ada filter cabang atau produk yang diterapkan.");
  return lines.join("\n\n");
}
