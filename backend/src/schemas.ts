import { ActivityStatus, ActivityType, Branch, CustomerStatus, LeadSource, LeadStatus, OpportunityStage, Role, TransactionStatus } from "@prisma/client";
import { z } from "zod";

const name = z.string().trim().min(2).max(150);
const id = z.string().trim().min(1).max(100);
const optionalText = z.string().trim().max(2000).nullable().optional();
const email = z.string().trim().email().max(254).toLowerCase();
const optionalEmail = z.union([email, z.literal("").transform(() => null)]).nullable().optional();
const phone = z.string().trim().min(6).max(30).regex(/^[+\d\s().-]+$/, "Enter a valid phone number.");
const money = z.number().finite().min(0).max(1_000_000_000_000).multipleOf(0.01);
const date = z.string().datetime({ offset: true });
const branch = z.nativeEnum(Branch).nullable().optional();
const password = z.string().min(12).max(72).refine(value => Buffer.byteLength(value, "utf8") <= 72, "Password must not exceed 72 UTF-8 bytes.");

export const loginSchema = z.object({ email, password: z.string().min(1).max(128) }).strict();
export const customerSchema = z.object({
  name, email: optionalEmail, phone, city: name, address: optionalText,
  segment: z.enum(["REGULAR", "VIP", "CORPORATE"]).default("REGULAR"),
  status: z.nativeEnum(CustomerStatus).optional(), branch, notes: optionalText, ownerId: id,
}).strict();
export const contactSchema = z.object({ name, email: optionalEmail, phone, title: optionalText, customerId: id }).strict();
export const leadSchema = z.object({
  name, email: optionalEmail, phone, source: z.nativeEnum(LeadSource),
  status: z.nativeEnum(LeadStatus), interest: optionalText, notes: optionalText,
  branch, productId: id.nullable().optional(),
  customerId: id.nullable().optional(), ownerId: id,
}).strict();
export const opportunitySchema = z.object({
  name, stage: z.nativeEnum(OpportunityStage), value: money,
  probability: z.number().int().min(0).max(100), expectedCloseDate: date,
  branch, productId: id.nullable().optional(), lostReason: optionalText, notes: optionalText, customerId: id, ownerId: id,
}).strict();
export const leadConversionSchema = z.object({
  expectedUpdatedAt: date,
  confirmLegacy: z.boolean().default(false),
  customer: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("existing"), customerId: id }).strict(),
    z.object({ mode: z.literal("new"), city: customerSchema.shape.city }).strict(),
  ]),
  opportunity: opportunitySchema.pick({ name: true, value: true, probability: true, expectedCloseDate: true }).strict(),
}).strict();
export const activitySchema = z.object({
  subject: name, type: z.nativeEnum(ActivityType), status: z.nativeEnum(ActivityStatus),
  dueAt: date, branch, notes: optionalText, customerId: id.nullable().optional(),
  opportunityId: id.nullable().optional(), ownerId: id,
}).strict();
export const productSchema = z.object({
  name, sku: z.string().trim().min(2).max(50), brand: name,
  category: name.default("Smartphone"), description: optionalText,
  price: money.positive(), stock: z.number().int().min(0).max(1_000_000), active: z.boolean().default(true),
}).strict();
export const transactionSchema = z.object({
  customerId: id, salespersonId: id, status: z.nativeEnum(TransactionStatus),
  soldAt: date, branch, opportunityId: id.nullable().optional(), notes: optionalText,
  items: z.array(z.object({ productId: id, quantity: z.number().int().min(1).max(1000) }).strict()).min(1).max(50),
}).strict().superRefine((data, ctx) => {
  if (new Set(data.items.map(item => item.productId)).size !== data.items.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["items"], message: "Each product may only appear once." });
  }
});
export const userCreateSchema = z.object({
  name, email, password, role: z.nativeEnum(Role), active: z.boolean().default(true),
}).strict();
export const userUpdateSchema = userCreateSchema.extend({ password: password.optional() });
