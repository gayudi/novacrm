import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import bcrypt from "bcryptjs";
import request from "supertest";
import type { Lead, LeadStatus, User } from "@prisma/client";
import { createApp } from "../src/app.js";
import { db } from "../src/db.js";

if (!process.env.DATABASE_URL || !new URL(process.env.DATABASE_URL).pathname.endsWith("_test") || process.env.ALLOW_INTEGRATION_TESTS !== "true") {
  throw new Error("Lead conversion tests require a dedicated _test database and ALLOW_INTEGRATION_TESTS=true.");
}
const prefix = `conversion-${randomUUID()}`;
const app = createApp();
const users: User[] = [];
const tokens: string[] = [];
const auth = (index = 0) => ({ Authorization: `Bearer ${tokens[index]}` });
let sequence = 0;
before(async () => {
  const password = "SyntheticConversionTest2026!";
  const passwordHash = await bcrypt.hash(password, 4);
  for (const role of ["SALES", "SALES", "MANAGER", "ADMIN"] as const) {
    const user = await db.user.create({ data: { name: `${prefix}-${role}`, email: `${prefix}-${users.length}@example.com`, role, passwordHash } });
    users.push(user);
    tokens.push((await request(app).post("/auth/login").send({ email: user.email, password }).expect(200)).body.token);
  }
});
after(async () => {
  const owners = users.map(user => user.id);
  await db.lead.deleteMany({ where: { ownerId: { in: owners } } });
  await db.opportunity.deleteMany({ where: { ownerId: { in: owners } } });
  await db.customer.deleteMany({ where: { ownerId: { in: owners } } });
  await db.product.deleteMany({ where: { sku: prefix } });
  await db.user.deleteMany({ where: { id: { in: owners } } });
  await db.$disconnect();
});
const lead = (status: LeadStatus = "QUALIFIED", owner = 0) => db.lead.create({
  data: {
    name: `${prefix}-Lead-${++sequence}`, email: `${prefix}-${sequence}@example.com`,
    phone: `+62812345${String(sequence).padStart(5, "0")}`, status, source: "INSTAGRAM", interest: "iPhone 16",
    branch: "BANDUNG", notes: "Original lead notes", ownerId: users[owner]!.id,
  },
});
const payload = (row: Lead) => ({
  expectedUpdatedAt: row.updatedAt.toISOString(), customer: { mode: "new", city: "Bandung" },
  opportunity: { name: `${prefix}-Deal`, value: 15000000, probability: 45, expectedCloseDate: "2026-12-15T10:00:00+07:00" },
});
const convert = (row: Lead, body = payload(row), actor = 0) => request(app).post(`/leads/${row.id}/convert`).set(auth(actor)).send(body);
const leadInput = (row: Lead) => ({
  name: row.name, email: row.email, phone: row.phone, status: row.status, source: row.source,
  interest: row.interest, notes: row.notes, branch: row.branch, customerId: row.customerId, ownerId: row.ownerId,
});
const counts = async () => [await db.customer.count(), await db.opportunity.count()];

test("Qualified conversion creates a customer and opportunity atomically, preserves source and links both ways", async () => {
  const product = await db.product.create({ data: { name: "Catalog smartphone", sku: prefix, brand: "Test", price: 15000000 } });
  const row = await db.lead.update({ where: { id: (await lead()).id }, data: { productId: product.id, interest: product.name } });
  const before = await counts();
  const response = await convert(row).expect(201);
  const saved = await db.lead.findUniqueOrThrow({ where: { id: row.id } });
  const customer = await db.customer.findUniqueOrThrow({ where: { id: response.body.customerId } });
  const opportunity = await db.opportunity.findUniqueOrThrow({ where: { id: response.body.opportunity.id } });
  assert.deepEqual(await counts(), before.map(n => n + 1));
  assert.equal(saved.status, "CONVERTED");
  assert.ok(saved.convertedAt);
  assert.equal(saved.convertedOpportunityId, opportunity.id);
  assert.equal(saved.customerId, customer.id);
  assert.deepEqual(saved.createdAt, row.createdAt);
  assert.equal(saved.source, row.source);
  assert.equal(opportunity.stage, "QUALIFIED");
  assert.equal(opportunity.productId, product.id);
  assert.equal(opportunity.value.toNumber(), 15000000);
  assert.equal(opportunity.probability, 45);
  assert.equal(opportunity.expectedCloseDate.toISOString(), "2026-12-15T03:00:00.000Z");
  for (const record of [customer, opportunity]) {
    assert.equal(record.ownerId, row.ownerId); assert.equal(record.branch, row.branch); assert.equal(record.notes, row.notes);
  }
  assert.equal(customer.name, row.name); assert.equal(customer.phone, row.phone); assert.equal(customer.email, row.email);
  const detail = (await request(app).get(`/leads/${row.id}`).set(auth()).expect(200)).body;
  assert.equal(detail.convertedOpportunity.id, opportunity.id);
  const dealDetail = (await request(app).get(`/opportunities/${opportunity.id}`).set(auth()).expect(200)).body;
  assert.equal(dealDetail.sourceLead.id, row.id);
  await convert(row).expect(409);
  assert.deepEqual(await counts(), before.map(n => n + 1));
  await request(app).delete(`/leads/${row.id}`).set(auth(3)).expect(409);
  await request(app).delete(`/opportunities/${opportunity.id}`).set(auth(3)).expect(409);
  await request(app).put(`/leads/${row.id}`).set(auth()).send({ ...leadInput(saved), status: "QUALIFIED" }).expect(409);
  await request(app).put(`/leads/${row.id}`).set(auth()).send({ ...leadInput(saved), customerId: null }).expect(409);
  await request(app).put(`/leads/${row.id}`).set(auth()).send({ ...leadInput(saved), notes: "Updated note" }).expect(200);
});

test("existing customer is reused without changing profile; Manager and Admin preserve the lead owner", async () => {
  const customer = await db.customer.create({ data: { name: "Existing inactive", phone: "+628899900011", city: "Jakarta", status: "INACTIVE", ownerId: users[0]!.id } });
  for (const actor of [0, 2, 3]) {
    const row = await lead();
    const before = await counts();
    const body = { ...payload(row), customer: { mode: "existing", customerId: customer.id } };
    const response = await request(app).post(`/leads/${row.id}/convert`).set(auth(actor)).send(body).expect(201);
    assert.deepEqual(await counts(), [before[0], before[1]! + 1]);
    assert.equal(response.body.customerId, customer.id);
    assert.deepEqual(await db.customer.findUniqueOrThrow({ where: { id: customer.id } }), customer);
    const opportunity = await db.opportunity.findUniqueOrThrow({ where: { id: response.body.opportunity.id } });
    assert.equal(opportunity.ownerId, users[0]!.id);
  }
});

test("only Qualified or explicitly confirmed historical Converted leads can convert; manual bypass is blocked", async () => {
  for (const status of ["NEW", "CONTACTED", "LOST"] as const) {
    const row = await lead(status);
    const before = await counts();
    await convert(row).expect(409);
    await request(app).post(`/leads/${row.id}/convert`).set(auth()).send({ ...payload(row), confirmLegacy: true }).expect(409);
    await request(app).put(`/leads/${row.id}`).set(auth()).send({ ...leadInput(row), status: "CONVERTED" }).expect(409);
    assert.deepEqual(await counts(), before);
  }
  const legacy = await lead("CONVERTED");
  await convert(legacy).expect(409);
  await request(app).put(`/leads/${legacy.id}`).set(auth()).send({ ...leadInput(legacy), status: "QUALIFIED" }).expect(409);
  await request(app).post(`/leads/${legacy.id}/convert`).set(auth()).send({ ...payload(legacy), confirmLegacy: true }).expect(201);
  await request(app).post(`/leads/${legacy.id}/convert`).set(auth()).send({ ...payload(legacy), confirmLegacy: true }).expect(409);
  const row = await lead();
  await request(app).post("/leads").set(auth()).send({ ...leadInput(row), status: "CONVERTED" }).expect(400);
});

test("foreign/cross-linked leads and customers are inaccessible, including conversion lookup", async () => {
  const row = await lead();
  const foreign = await lead("QUALIFIED", 1);
  const customer = await db.customer.create({ data: { name: "Foreign secret", phone: "+628888888888", city: "Medan", ownerId: users[1]!.id } });
  const cross = await lead();
  await db.lead.update({ where: { id: cross.id }, data: { customerId: customer.id } });
  const before = await counts();
  await convert(foreign).expect(404);
  await convert(cross).expect(404);
  for (const actor of [0, 2, 3]) {
    await request(app).post(`/leads/${row.id}/convert`).set(auth(actor)).send({ ...payload(row), customer: { mode: "existing", customerId: customer.id } }).expect(404);
  }
  await request(app).get(`/leads/${foreign.id}/conversion-customers`).set(auth()).expect(404);
  const options = (await request(app).get(`/leads/${row.id}/conversion-customers?search=Foreign`).set(auth()).expect(200)).body;
  assert.equal(options.total, 0);
  await request(app).post(`/leads/${row.id}/convert`).send(payload(row)).expect(401);
  assert.deepEqual(await counts(), before);
});

test("duplicate phone/email, stale inputs, invalid fields and inactive ownership leave no partial records", async () => {
  const row = await lead();
  const duplicate = await db.customer.create({ data: { name: "Existing duplicate", phone: row.phone.replace("+62", "0"), city: "Medan", ownerId: users[1]!.id } });
  const before = await counts();
  await convert(row).expect(409);
  await db.customer.update({ where: { id: duplicate.id }, data: { phone: "+6280011111111", email: row.email } });
  await convert(row).expect(409);
  await db.customer.delete({ where: { id: duplicate.id } });
  const valid = await lead();
  await db.lead.update({ where: { id: valid.id }, data: { updatedAt: new Date(valid.updatedAt.getTime() + 1000) } });
  await convert(valid).expect(409);
  const fresh = await lead();
  for (const changes of [
    { ownerId: users[1]!.id }, { opportunity: { ...payload(fresh).opportunity, stage: "WON" } },
    { opportunity: { ...payload(fresh).opportunity, value: -1 } },
    { opportunity: { ...payload(fresh).opportunity, probability: 101 } },
    { opportunity: { ...payload(fresh).opportunity, expectedCloseDate: "invalid" } },
    { customer: { mode: "existing", customerId: "" } },
    { customer: { mode: "new", city: "" } },
  ]) await request(app).post(`/leads/${fresh.id}/convert`).set(auth()).send({ ...payload(fresh), ...changes }).expect(400);
  await db.user.update({ where: { id: users[1]!.id }, data: { active: false } });
  try { await convert(await lead("QUALIFIED", 1), undefined, 3).expect(409); }
  finally { await db.user.update({ where: { id: users[1]!.id }, data: { active: true } }); }
  assert.deepEqual(await counts(), [before[0]! - 1, before[1]]);
  assert.equal((await db.lead.findUniqueOrThrow({ where: { id: row.id } })).status, "QUALIFIED");
});

test("simultaneous conversions create exactly one opportunity and customer", async () => {
  const row = await lead();
  const before = await counts();
  const responses = await Promise.all([convert(row), convert(row)]);
  assert.deepEqual(responses.map(response => response.status).sort(), [201, 409]);
  assert.deepEqual(await counts(), before.map(n => n + 1));
});

test("a failure at the final lead update rolls back the new customer and opportunity", async () => {
  const row = await lead();
  assert.match(row.id, /^[a-z0-9]+$/);
  const before = await counts();
  await db.$executeRawUnsafe("CREATE FUNCTION conversion_test_cancel_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END; $$");
  try {
    await db.$executeRawUnsafe(`CREATE TRIGGER conversion_test_cancel_update BEFORE UPDATE ON leads FOR EACH ROW WHEN (OLD.id = '${row.id}') EXECUTE FUNCTION conversion_test_cancel_update()`);
    await convert(row).expect(404);
    assert.deepEqual(await counts(), before);
    assert.deepEqual(await db.lead.findUniqueOrThrow({ where: { id: row.id } }), row);
  } finally {
    await db.$executeRawUnsafe("DROP TRIGGER IF EXISTS conversion_test_cancel_update ON leads");
    await db.$executeRawUnsafe("DROP FUNCTION conversion_test_cancel_update()");
  }
});

test("linked record names remain scoped after opportunity ownership changes", async () => {
  const row = await lead();
  const response = await convert(row).expect(201);
  await db.opportunity.update({ where: { id: response.body.opportunity.id }, data: { ownerId: users[1]!.id } });
  const detail = (await request(app).get(`/leads/${row.id}`).set(auth()).expect(200)).body;
  assert.equal(detail.convertedOpportunity, null);
  const company = (await request(app).get(`/leads/${row.id}`).set(auth(3)).expect(200)).body;
  assert.equal(company.convertedOpportunity.id, response.body.opportunity.id);
});
