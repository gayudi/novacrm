import { Prisma } from "@prisma/client";
import { db } from "./db.js";
import { HttpError, type Principal } from "./http.js";

export const customerScope = (user: Principal): Prisma.CustomerWhereInput =>
  user.role === "SALES" ? { ownerId: user.id } : {};
export const contactScope = (user: Principal): Prisma.ContactWhereInput =>
  user.role === "SALES" ? { customer: customerScope(user) } : {};
export const leadScope = (user: Principal): Prisma.LeadWhereInput =>
  user.role === "SALES" ? { ownerId: user.id, AND: [{ OR: [{ customerId: null }, { customer: customerScope(user) }] }] } : {};
export const opportunityScope = (user: Principal): Prisma.OpportunityWhereInput =>
  user.role === "SALES" ? { ownerId: user.id, customer: customerScope(user) } : {};
export const activityScope = (user: Principal): Prisma.ActivityWhereInput =>
  user.role === "SALES" ? {
    ownerId: user.id,
    AND: [
      { OR: [{ customerId: null }, { customer: customerScope(user) }] },
      { OR: [{ opportunityId: null }, { opportunity: opportunityScope(user) }] },
    ],
  } : {};
export const transactionScope = (user: Principal): Prisma.SalesTransactionWhereInput =>
  user.role === "SALES" ? {
    salespersonId: user.id, customer: customerScope(user),
    AND: [{ OR: [{ opportunityId: null }, { opportunity: opportunityScope(user) }] }],
  } : {};

// SQL counterpart of transactionScope for the dashboard's weekly aggregation.
export const transactionScopeSql = (user: Principal) => user.role !== "SALES" ? Prisma.empty : Prisma.sql`
  AND "salespersonId" = ${user.id}
  AND "customerId" IN (SELECT id FROM customers WHERE "ownerId" = ${user.id})
  AND ("opportunityId" IS NULL OR "opportunityId" IN (
    SELECT o.id FROM opportunities o JOIN customers c ON c.id = o."customerId"
    WHERE o."ownerId" = ${user.id} AND c."ownerId" = ${user.id}
  ))`;

export function assertAssignment(user: Principal, ownerId: string) {
  if (user.role === "SALES" && ownerId !== user.id) {
    throw new HttpError(403, "Sales can only assign records to themselves.");
  }
}

export async function assertLinks(
  user: Principal,
  links: { customerId?: string | null; opportunityId?: string | null },
  client: Prisma.TransactionClient = db,
) {
  if (user.role !== "SALES") return;
  if (links.customerId && !await client.customer.findFirst({ where: { ...customerScope(user), id: links.customerId }, select: { id: true } })) {
    throw new HttpError(404, "Linked record not found.");
  }
  if (links.opportunityId && !await client.opportunity.findFirst({ where: { ...opportunityScope(user), id: links.opportunityId }, select: { id: true } })) {
    throw new HttpError(404, "Linked record not found.");
  }
}
