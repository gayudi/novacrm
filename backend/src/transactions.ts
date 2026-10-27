import { randomUUID } from "node:crypto";
import { Branch, Prisma, TransactionStatus } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { db } from "./db.js";
import { crud, pagination } from "./crud.js";
import { asyncRoute, HttpError, principal, type Principal } from "./http.js";
import { transactionSchema } from "./schemas.js";
import { assertAssignment, assertLinks, transactionScope } from "./access.js";

type TransactionInput = z.infer<typeof transactionSchema>;
const transactionFilters = z.object({
  branch: z.nativeEnum(Branch).optional(),
  salespersonId: z.string().trim().min(1).max(200).optional(),
  period: z.enum(["all", "week", "month", "quarter"]).default("all"),
});

export function transactionPeriod(period: z.infer<typeof transactionFilters>["period"], now = new Date()) {
  if (period === "all") return undefined;
  const offset = 7 * 60 * 60 * 1000;
  const local = new Date(now.getTime() + offset);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth();
  const day = local.getUTCDate();
  const startMonth = period === "quarter" ? Math.floor(month / 3) * 3 : month;
  const monday = day - (local.getUTCDay() + 6) % 7;
  const start = period === "week" ? Date.UTC(year, month, monday) : Date.UTC(year, startMonth, 1);
  const end = period === "week" ? Date.UTC(year, month, monday + 7) : Date.UTC(year, startMonth + (period === "quarter" ? 3 : 1), 1);
  return { gte: new Date(start - offset), lt: new Date(end - offset) };
}

const include = {
  customer: { select: { id: true, name: true } },
  salesperson: { select: { id: true, name: true } },
  opportunity: { select: { id: true, name: true } },
  items: { include: { product: { select: { id: true, name: true, sku: true } } } },
} as const;

export async function serializable<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034" && attempt < 2) continue;
      throw error;
    }
  }
}

async function saveTransaction(data: TransactionInput, user: Principal, id?: string) {
  assertAssignment(user, data.salespersonId);
  return serializable(async tx => {
    const previous = id ? await tx.salesTransaction.findFirst({ where: { ...transactionScope(user), id }, include: { items: true } }) : null;
    if (id && !previous) throw new HttpError(404, "Transaction not found.");
    await assertLinks(user, data, tx);
    const salesperson = await tx.user.findFirst({ where: { id: data.salespersonId, active: true } });
    if (!salesperson) throw new HttpError(400, "Choose an active salesperson.");
    if (data.opportunityId) {
      const opportunity = await tx.opportunity.findUnique({ where: { id: data.opportunityId } });
      if (!opportunity || opportunity.customerId !== data.customerId) {
        throw new HttpError(400, "The selected opportunity must belong to the selected customer.");
      }
    }
    const products = await tx.product.findMany({ where: { id: { in: data.items.map(item => item.productId) } } });
    const items = data.items.map(item => {
      const product = products.find(p => p.id === item.productId);
      const oldItem = previous?.items.find(i => i.productId === item.productId);
      if (!product || (!product.active && !oldItem)) throw new HttpError(400, "One or more products are unavailable.");
      const unitPrice = oldItem?.unitPrice ?? product.price;
      return { ...item, unitPrice, subtotal: unitPrice.mul(item.quantity) };
    });

    // Restore the old movement first; the entire edit rolls back if any new item is out of stock.
    if (previous?.status === "COMPLETED") {
      for (const item of previous.items) {
        await tx.product.update({ where: { id: item.productId }, data: { stock: { increment: item.quantity } } });
      }
    }
    if (data.status === "COMPLETED") {
      for (const item of items) {
        const result = await tx.product.updateMany({
          where: { id: item.productId, stock: { gte: item.quantity } },
          data: { stock: { decrement: item.quantity } },
        });
        if (result.count !== 1) {
          throw new HttpError(409, `Insufficient stock for ${products.find(p => p.id === item.productId)?.name}.`);
        }
      }
    }
    const values = {
      customerId: data.customerId, salespersonId: data.salespersonId, status: data.status,
      soldAt: data.soldAt, branch: data.branch, opportunityId: data.opportunityId, notes: data.notes, total: items.reduce((sum, item) => sum.add(item.subtotal), new Prisma.Decimal(0)),
    };
    if (id) {
      return tx.salesTransaction.update({ where: { id }, data: { ...values, items: { deleteMany: {}, create: items } }, include });
    }
    return tx.salesTransaction.create({
      data: { ...values, invoice: `NV-${new Date().getUTCFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`, items: { create: items } }, include,
    });
  });
}

export const transactionsRouter = Router();
transactionsRouter.get("/filter-options", asyncRoute(async (req, res) => {
  const salespeople = await db.user.findMany({
    where: { transactions: { some: transactionScope(principal(req)) } },
    select: { id: true, name: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  res.json({ salespeople });
}));
transactionsRouter.use(crud(transactionSchema, {
  list: async (q, req) => {
    const filters = transactionFilters.parse(req.query);
    const where: Prisma.SalesTransactionWhereInput = {
      AND: [transactionScope(principal(req)), {
        branch: filters.branch,
        salespersonId: filters.salespersonId,
        soldAt: transactionPeriod(filters.period),
      }],
      status: q.status ? z.nativeEnum(TransactionStatus).parse(q.status) : undefined,
      OR: [{ invoice: { contains: q.search, mode: "insensitive" } }, { customer: { name: { contains: q.search, mode: "insensitive" } } }],
    };
    const [data, total] = await db.$transaction([
      db.salesTransaction.findMany({ where, ...pagination(q), orderBy: [{ createdAt: "desc" }, { id: "asc" }], include }), db.salesTransaction.count({ where }),
    ]);
    return { data, total };
  },
  get: (id, req) => db.salesTransaction.findFirst({ where: { ...transactionScope(principal(req)), id }, include }),
  create: (data, req) => saveTransaction(data, principal(req)),
  update: (id, data, req) => saveTransaction(data, principal(req), id),
  remove: id => serializable(async tx => {
    const record = await tx.salesTransaction.findUnique({ where: { id }, include: { items: true } });
    if (!record) throw new HttpError(404, "Transaction not found.");
    if (record.status === "COMPLETED") {
      for (const item of record.items) {
        await tx.product.update({ where: { id: item.productId }, data: { stock: { increment: item.quantity } } });
      }
    }
    return tx.salesTransaction.delete({ where: { id } });
  }),
}));
