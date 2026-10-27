import { Router } from "express";
import { ActivityStatus, CustomerStatus, LeadStatus, OpportunityStage, Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "./db.js";
import { crud, pagination } from "./crud.js";
import { activitySchema, contactSchema, customerSchema, leadSchema, opportunitySchema, productSchema } from "./schemas.js";
import { asyncRoute, HttpError, principal, type Principal } from "./http.js";
import { publicUser } from "./auth.js";
import { activityScope, assertAssignment, assertLinks, contactScope, customerScope, leadScope, opportunityScope, transactionScope } from "./access.js";
import { leadConversionRouter } from "./lead-conversion.js";
import { serializable } from "./transactions.js";

const owner = { select: { id: true, name: true } };
const customer = { select: { id: true, name: true } };
const leadInclude = (user: Principal) => ({
  owner, customer, convertedOpportunity: { where: opportunityScope(user), select: { id: true, name: true } },
});
const opportunityInclude = (user: Principal) => ({
  owner, customer, sourceLead: { where: leadScope(user), select: { id: true, name: true } },
});
export const resources = Router();

async function validateOwner(ownerId: string, user: Principal) {
  assertAssignment(user, ownerId);
  if (!await db.user.findFirst({ where: { id: ownerId, active: true } })) {
    throw new HttpError(400, "Choose an active team member.");
  }
}

resources.use("/customers", crud(customerSchema, {
  list: async (q, req) => {
    const where: Prisma.CustomerWhereInput = {
      ...customerScope(principal(req)),
      status: q.status ? z.nativeEnum(CustomerStatus).parse(q.status) : undefined,
      OR: ["name", "email", "phone", "city"].map(key => ({ [key]: { contains: q.search, mode: "insensitive" } })),
    };
    const [data, total] = await db.$transaction([
      db.customer.findMany({ where, ...pagination(q), include: { owner, _count: { select: { transactions: { where: transactionScope(principal(req)) }, contacts: true } } } }),
      db.customer.count({ where }),
    ]);
    return { data, total };
  },
  get: (id, req) => db.customer.findFirst({ where: { ...customerScope(principal(req)), id }, include: { owner } }),
  create: async (data, req) => { await validateOwner(data.ownerId, principal(req)); return db.customer.create({ data }); },
  update: async (id, data, req) => { await validateOwner(data.ownerId, principal(req)); return db.customer.update({ where: { id, AND: customerScope(principal(req)) }, data }); },
  remove: id => db.customer.delete({ where: { id } }),
}));

resources.use("/contacts", crud(contactSchema, {
  list: async (q, req) => {
    const where: Prisma.ContactWhereInput = { ...contactScope(principal(req)), OR: [
      { name: { contains: q.search, mode: "insensitive" } }, { email: { contains: q.search, mode: "insensitive" } },
      { customer: { name: { contains: q.search, mode: "insensitive" } } },
    ] };
    const [data, total] = await db.$transaction([
      db.contact.findMany({ where, ...pagination(q), include: { customer } }), db.contact.count({ where }),
    ]);
    return { data, total };
  },
  get: (id, req) => db.contact.findFirst({ where: { ...contactScope(principal(req)), id }, include: { customer } }),
  create: async (data, req) => { await assertLinks(principal(req), data); return db.contact.create({ data }); },
  update: async (id, data, req) => { await assertLinks(principal(req), data); return db.contact.update({ where: { ...contactScope(principal(req)), id }, data }); },
  remove: id => db.contact.delete({ where: { id } }),
}));

resources.use("/leads", leadConversionRouter);
resources.use("/leads", crud(leadSchema, {
  list: async (q, req) => {
    const where: Prisma.LeadWhereInput = {
      ...leadScope(principal(req)),
      status: q.status ? z.nativeEnum(LeadStatus).parse(q.status) : undefined,
      OR: [{ name: { contains: q.search, mode: "insensitive" } }, { email: { contains: q.search, mode: "insensitive" } }, { interest: { contains: q.search, mode: "insensitive" } }],
    };
    const [data, total] = await db.$transaction([
      db.lead.findMany({ where, ...pagination(q), orderBy: [{ createdAt: "desc" }, { id: "asc" }], include: leadInclude(principal(req)) }), db.lead.count({ where }),
    ]);
    return { data, total };
  },
  get: (id, req) => db.lead.findFirst({ where: { ...leadScope(principal(req)), id }, include: leadInclude(principal(req)) }),
  create: async (data, req) => {
    if (data.status === "CONVERTED") throw new HttpError(400, "Gunakan fitur konversi untuk mengubah lead menjadi Converted.");
    await validateOwner(data.ownerId, principal(req)); await assertLinks(principal(req), data);
    return db.lead.create({ data });
  },
  update: async (id, data, req) => {
    await validateOwner(data.ownerId, principal(req)); await assertLinks(principal(req), data);
    return serializable(async tx => {
      const previous = await tx.lead.findFirst({ where: { ...leadScope(principal(req)), id } });
      if (!previous) throw new HttpError(404, "Lead tidak ditemukan.");
      if (data.status !== previous.status && (data.status === "CONVERTED" || previous.status === "CONVERTED")) throw new HttpError(409, "Status Converted hanya dikelola melalui fitur konversi dan tidak dapat diubah manual.");
      if (previous.convertedAt && (data.ownerId !== previous.ownerId || (data.customerId ?? null) !== previous.customerId)) throw new HttpError(409, "Pemilik dan customer lead hasil konversi merupakan riwayat tetap. Kelola proses penjualan melalui opportunity.");
      return tx.lead.update({ where: { id }, data });
    });
  },
  remove: id => serializable(async tx => {
    const lead = await tx.lead.findUnique({ where: { id } });
    if (!lead) throw new HttpError(404, "Lead tidak ditemukan.");
    if (lead.convertedAt) throw new HttpError(409, "Lead hasil konversi tidak dapat dihapus agar riwayat asal opportunity tetap tersimpan.");
    return tx.lead.delete({ where: { id } });
  }),
}));

resources.use("/opportunities", crud(opportunitySchema, {
  list: async (q, req) => {
    const where: Prisma.OpportunityWhereInput = {
      ...opportunityScope(principal(req)),
      stage: q.status ? z.nativeEnum(OpportunityStage).parse(q.status) : undefined,
      OR: [{ name: { contains: q.search, mode: "insensitive" } }, { customer: { name: { contains: q.search, mode: "insensitive" } } }],
    };
    const [data, total] = await db.$transaction([
      db.opportunity.findMany({ where, ...pagination(q), include: opportunityInclude(principal(req)) }), db.opportunity.count({ where }),
    ]);
    return { data, total };
  },
  get: (id, req) => db.opportunity.findFirst({ where: { ...opportunityScope(principal(req)), id }, include: opportunityInclude(principal(req)) }),
  create: async (data, req) => { await validateOwner(data.ownerId, principal(req)); await assertLinks(principal(req), data); return db.opportunity.create({ data }); },
  update: async (id, data, req) => { await validateOwner(data.ownerId, principal(req)); await assertLinks(principal(req), data); return db.opportunity.update({ where: { ...opportunityScope(principal(req)), id }, data }); },
  remove: id => db.opportunity.delete({ where: { id } }),
}));

async function validateActivity(data: z.infer<typeof activitySchema>, user: Principal) {
  await validateOwner(data.ownerId, user);
  await assertLinks(user, data);
  if (data.opportunityId && data.customerId) {
    const opportunity = await db.opportunity.findUnique({ where: { id: data.opportunityId } });
    if (!opportunity || opportunity.customerId !== data.customerId) {
      throw new HttpError(400, "The selected opportunity must belong to the selected customer.");
    }
  }
}
resources.use("/activities", crud(activitySchema, {
  list: async (q, req) => {
    const where: Prisma.ActivityWhereInput = {
      ...activityScope(principal(req)),
      status: q.status ? z.nativeEnum(ActivityStatus).parse(q.status) : undefined,
      subject: { contains: q.search, mode: "insensitive" },
    };
    const [data, total] = await db.$transaction([
      db.activity.findMany({ where, ...pagination(q), include: { owner, customer, opportunity: { select: { id: true, name: true } } } }),
      db.activity.count({ where }),
    ]);
    return { data, total };
  },
  get: (id, req) => db.activity.findFirst({ where: { ...activityScope(principal(req)), id }, include: { owner, customer } }),
  create: async (data, req) => { await validateActivity(data, principal(req)); return db.activity.create({ data }); },
  update: async (id, data, req) => { await validateActivity(data, principal(req)); return db.activity.update({ where: { ...activityScope(principal(req)), id }, data }); },
  remove: id => db.activity.delete({ where: { id } }),
}));

resources.use("/products", crud(productSchema, {
  list: async q => {
    const where: Prisma.ProductWhereInput = {
      OR: ["name", "sku", "brand"].map(key => ({ [key]: { contains: q.search, mode: "insensitive" } })),
    };
    const [data, total] = await db.$transaction([db.product.findMany({ where, ...pagination(q) }), db.product.count({ where })]);
    return { data, total };
  },
  get: id => db.product.findUnique({ where: { id } }),
  create: data => db.product.create({ data }),
  update: (id, data) => db.product.update({ where: { id }, data }),
  remove: id => db.product.delete({ where: { id } }),
}, ["ADMIN", "MANAGER"]));

resources.get("/lookups", asyncRoute(async (req, res) => {
  const user = principal(req);
  const [customers, users, products, opportunities] = await Promise.all([
    db.customer.findMany({ where: customerScope(user), select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.user.findMany({ where: user.role === "SALES" ? { id: user.id } : {}, select: publicUser, orderBy: { name: "asc" } }),
    db.product.findMany({ select: { id: true, name: true, price: true, stock: true, active: true }, orderBy: { name: "asc" } }),
    db.opportunity.findMany({ where: opportunityScope(user), select: { id: true, name: true, customerId: true }, orderBy: { name: "asc" } }),
  ]);
  res.json({ customers, users, products, opportunities });
}));
