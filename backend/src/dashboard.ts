import { Router } from "express";
import { db } from "./db.js";
import { Branch, Prisma } from "@prisma/client";
import { asyncRoute, principal } from "./http.js";
import { activityScope, customerScope, leadScope, opportunityScope, transactionScope, transactionScopeSql } from "./access.js";

export function monthStart(date: Date, offset = 0): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1));
}

export const dashboardRouter = Router();
dashboardRouter.get("/", asyncRoute(async (req, res) => {
  const user = principal(req);
  const now = new Date();
  const current = monthStart(now);
  const last = monthStart(now, -1);
  const next = monthStart(now, 1);
  const historyStart = monthStart(now, -2);
  const sales = transactionScope(user);
  const historicalSales = { ...sales, status: "COMPLETED" as const, soldAt: { gte: historyStart, lt: next } };
  const completedThisMonth = { ...sales, status: "COMPLETED" as const, soldAt: { gte: current, lt: next } };
  const result = await db.$transaction(async tx => {
    const [totalCustomers, totalLeads, totalOpportunities, thisMonth, lastMonth, pipeline, leadSources, stages, recentActivities, topProducts, topSalespeople, monthly, customerStatuses, branchSales, weeklySales, activityTypes, sampleData] = await Promise.all([
      tx.customer.count({ where: customerScope(user) }), tx.lead.count({ where: leadScope(user) }), tx.opportunity.count({ where: opportunityScope(user) }),
      tx.salesTransaction.aggregate({ where: completedThisMonth, _sum: { total: true }, _count: true }),
      tx.salesTransaction.aggregate({ where: { ...sales, status: "COMPLETED", soldAt: { gte: last, lt: current } }, _sum: { total: true } }),
      tx.opportunity.aggregate({ where: { ...opportunityScope(user), stage: { notIn: ["WON", "LOST"] } }, _sum: { value: true } }),
      tx.lead.groupBy({ by: ["source"], where: leadScope(user), _count: true }),
      tx.opportunity.groupBy({ by: ["stage"], where: opportunityScope(user), _count: true, _sum: { value: true } }),
      tx.activity.findMany({ where: activityScope(user), take: 5, orderBy: { updatedAt: "desc" }, include: { owner: { select: { name: true } }, customer: { select: { name: true } } } }),
      tx.salesTransactionItem.groupBy({
        by: ["productId"], where: { transaction: completedThisMonth },
        _sum: { quantity: true, subtotal: true }, orderBy: { _sum: { subtotal: "desc" } }, take: 5,
      }),
      tx.salesTransaction.groupBy({
        by: ["salespersonId"], where: completedThisMonth,
        _sum: { total: true }, _count: true, orderBy: { _sum: { total: "desc" } }, take: 4,
      }),
      Promise.all(Array.from({ length: 3 }, async (_, index) => {
        const start = monthStart(now, index - 2);
        const end = monthStart(now, index - 1);
        const aggregate = await tx.salesTransaction.aggregate({
          where: { ...sales, status: "COMPLETED", soldAt: { gte: start, lt: end } }, _sum: { total: true }, _count: true,
        });
        return { month: start.toLocaleString("en-US", { month: "short", timeZone: "UTC" }), start: start.toISOString(), revenue: Number(aggregate._sum.total ?? 0), sales: aggregate._count };
      })),
      tx.customer.groupBy({ by: ["status"], where: customerScope(user), _count: true }),
      tx.salesTransaction.groupBy({ by: ["branch"], where: historicalSales, _sum: { total: true }, _count: true }),
      tx.$queryRaw<{ week: Date; revenue: Prisma.Decimal; sales: bigint }[]>`
        SELECT date_trunc('week', "soldAt") AS week, sum(total) AS revenue, count(*) AS sales
        FROM sales_transactions WHERE status = 'COMPLETED'
          AND "soldAt" >= ${historyStart.toISOString()}::timestamp AND "soldAt" < ${next.toISOString()}::timestamp
          ${transactionScopeSql(user)}
        GROUP BY 1 ORDER BY 1`,
      tx.activity.groupBy({ by: ["type"], where: { ...activityScope(user), createdAt: { gte: historyStart, lt: next } }, _count: true }),
      user.role === "SALES" ? null : tx.seedBatch.findUnique({ where: { id: "retail-history-v1" }, select: { periodStart: true, periodEnd: true, counts: true } }),
    ]);
    const [products, salespeople] = await Promise.all([
      tx.product.findMany({ where: { id: { in: topProducts.map(p => p.productId) } } }),
      tx.user.findMany({ where: { id: { in: topSalespeople.map(p => p.salespersonId) } }, select: { id: true, name: true } }),
    ]);
    const weekly: { week: string; revenue: number; sales: number }[] = [];
    const week = new Date(historyStart);
    week.setUTCDate(week.getUTCDate() - (week.getUTCDay() + 6) % 7);
    while (week <= now) {
      const row = weeklySales.find(s => s.week.getTime() === week.getTime());
      weekly.push({ week: week.toISOString(), revenue: Number(row?.revenue ?? 0), sales: Number(row?.sales ?? 0) });
      week.setUTCDate(week.getUTCDate() + 7);
    }
    return {
      scope: user.role === "SALES" ? "own" : "company",
      totalCustomers, totalLeads, totalOpportunities, revenueThisMonth: Number(thisMonth._sum.total ?? 0),
      revenueLastMonth: Number(lastMonth._sum.total ?? 0), pipelineValue: Number(pipeline._sum.value ?? 0),
      completedSalesThisMonth: thisMonth._count, monthly,
      weekly,
      customerStatuses: ["ACTIVE", "INACTIVE"].map(status => ({ status, count: customerStatuses.find(s => s.status === status)?._count ?? 0 })),
      branchPerformance: [...Object.values(Branch), "UNASSIGNED"].map(branch => {
        const row = branchSales.find(s => (s.branch ?? "UNASSIGNED") === branch);
        return { branch, sales: row?._count ?? 0, revenue: Number(row?._sum.total ?? 0) };
      }),
      activityTypes: activityTypes.map(a => ({ type: a.type, count: a._count })),
      outcomes: [
        { stage: "WON", count: stages.find(s => s.stage === "WON")?._count ?? 0 },
        { stage: "LOST", count: stages.find(s => s.stage === "LOST")?._count ?? 0 },
        { stage: "OPEN", count: stages.filter(s => !["WON", "LOST"].includes(s.stage)).reduce((sum, s) => sum + s._count, 0) },
      ],
      sampleData,
      leadSources: leadSources.map(s => ({ source: s.source, count: s._count })),
      pipeline: stages.map(s => ({ stage: s.stage, count: s._count, value: Number(s._sum.value ?? 0) })),
      recentActivities,
      topProducts: topProducts.map(p => ({
        id: p.productId, name: products.find(product => product.id === p.productId)?.name,
        brand: products.find(product => product.id === p.productId)?.brand,
        units: p._sum.quantity ?? 0, revenue: Number(p._sum.subtotal ?? 0),
      })),
      topSalespeople: topSalespeople.map(p => ({
        id: p.salespersonId, name: salespeople.find(user => user.id === p.salespersonId)?.name,
        sales: p._count, revenue: Number(p._sum.total ?? 0),
      })),
      period: { start: current.toISOString(), end: next.toISOString(), historyStart: historyStart.toISOString(), timezone: "UTC" },
    };
  }, { isolationLevel: "RepeatableRead", timeout: 15000 });
  res.json(result);
}));
