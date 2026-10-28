import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import bcrypt from "bcryptjs";
import request from "supertest";
import { app } from "../src/app.js";
import { db } from "../src/db.js";
import { monthStart } from "../src/dashboard.js";

const database = process.env.DATABASE_URL;
if (!database || !new URL(database).pathname.endsWith("_test") || process.env.ALLOW_INTEGRATION_TESTS !== "true") {
  throw new Error("Integration tests require a dedicated DATABASE_URL ending in _test and ALLOW_INTEGRATION_TESTS=true.");
}
const prefix = `test-${randomUUID().slice(0, 8)}`;
const password = "IntegrationPassword2026!";
let adminId: string;
let salesId: string;
let customerId: string;
let productId: string;
let adminToken: string;
let salesToken: string;
let managerToken: string;
const headers = () => ({ Authorization: `Bearer ${adminToken}` });
const customerInput = () => ({ name: `${prefix} Customer`, email: `${prefix}@example.com`, phone: "+6281234567890", city: "Jakarta", segment: "VIP", ownerId: salesId });
const productInput = () => ({ name: `${prefix} Smartphone`, sku: `${prefix}-PHONE`, brand: "Test", price: 1000000, stock: 10, active: true });
const saleInput = (quantity = 1, status = "COMPLETED") => ({
  customerId, salespersonId: salesId, status, soldAt: new Date().toISOString(), notes: prefix,
  items: [{ productId, quantity }],
});

before(async () => {
  const passwordHash = await bcrypt.hash(password, 4);
  const admin = await db.user.create({ data: { name: `${prefix} Admin`, email: `${prefix}-admin@example.com`, role: "ADMIN", passwordHash } });
  const sales = await db.user.create({ data: { name: `${prefix} Sales`, email: `${prefix}-sales@example.com`, role: "SALES", passwordHash } });
  const manager = await db.user.create({ data: { name: `${prefix} Manager`, email: `${prefix}-manager@example.com`, role: "MANAGER", passwordHash } });
  adminId = admin.id; salesId = sales.id;
  for (const [user, assign] of [
    [admin, (token: string) => { adminToken = token; }],
    [sales, (token: string) => { salesToken = token; }],
    [manager, (token: string) => { managerToken = token; }],
  ] as const) {
    const response = await request(app).post("/auth/login").send({ email: user.email, password }).expect(200);
    assign(response.body.token);
    assert.equal(response.body.user.passwordHash, undefined);
  }
  customerId = (await request(app).post("/customers").set(headers()).send(customerInput()).expect(201)).body.id;
  productId = (await request(app).post("/products").set(headers()).send(productInput()).expect(201)).body.id;
});

after(async () => {
  const users = await db.user.findMany({ where: { name: { startsWith: prefix } }, select: { id: true } });
  const ids = users.map(user => user.id);
  await db.salesTransaction.deleteMany({ where: { salespersonId: { in: ids } } });
  await db.activity.deleteMany({ where: { ownerId: { in: ids } } });
  await db.opportunity.deleteMany({ where: { ownerId: { in: ids } } });
  await db.lead.deleteMany({ where: { ownerId: { in: ids } } });
  await db.customer.deleteMany({ where: { ownerId: { in: ids } } });
  await db.product.deleteMany({ where: { sku: { startsWith: prefix } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.$disconnect();
});

test("health, authentication, role boundaries, and safe user responses", async () => {
  await request(app).get("/health").expect(200);
  await request(app).get("/customers").expect(401);
  await request(app).get("/dashboard").set("Authorization", "Bearer invalid").expect(401);
  await request(app).post("/auth/login").send({ email: `${prefix}-admin@example.com`, password: "wrong" }).expect(401);
  await request(app).get("/users").set("Authorization", `Bearer ${salesToken}`).expect(403);
  await request(app).get("/users").set("Authorization", `Bearer ${managerToken}`).expect(403);
  await request(app).post("/products").set("Authorization", `Bearer ${salesToken}`).send(productInput()).expect(403);
  await request(app).delete(`/customers/${customerId}`).set("Authorization", `Bearer ${salesToken}`).expect(403);
  const response = await request(app).get("/users").set(headers()).expect(200);
  assert.ok(response.body.data.every((user: Record<string, unknown>) => user.passwordHash === undefined));
  const lookups = await request(app).get("/lookups").set("Authorization", `Bearer ${salesToken}`).expect(200);
  assert.ok(lookups.body.users.every((user: Record<string, unknown>) => user.passwordHash === undefined));
});

test("customers support create, search, pagination, get, update, conflict and delete", async () => {
  const input = { ...customerInput(), name: `${prefix} Disposable`, email: `${prefix}-disposable@example.com` };
  const created = await request(app).post("/customers").set("Authorization", `Bearer ${salesToken}`).send(input).expect(201);
  const id = created.body.id;
  await request(app).post("/customers").set(headers()).send(input).expect(409);
  const search = await request(app).get(`/customers?search=${prefix}&pageSize=1`).set(headers()).expect(200);
  assert.equal(search.body.data.length, 1); assert.equal(search.body.pageSize, 1); assert.ok(search.body.total >= 2);
  await request(app).get(`/customers/${id}`).set(headers()).expect(200);
  const edited = await request(app).put(`/customers/${id}`).set(headers()).send({ ...input, city: "Bandung" }).expect(200);
  assert.equal(edited.body.city, "Bandung");
  await request(app).delete(`/customers/${id}`).set("Authorization", `Bearer ${managerToken}`).expect(204);
  await request(app).get(`/customers/${id}`).set(headers()).expect(404);
  await request(app).get("/customers?pageSize=1000").set(headers()).expect(400);
});

test("contacts, leads, opportunities and activities implement full CRUD with relationship validation", async () => {
  const scenarios = [
    { path: "contacts", input: { name: `${prefix} Contact`, email: "", phone: "+6281234567890", title: "Buyer", customerId }, update: { title: "Decision maker" } },
    { path: "leads", input: { name: `${prefix} Lead`, phone: "+6281234567890", source: "WEBSITE", status: "NEW", ownerId: salesId, customerId }, update: { status: "QUALIFIED" } },
    { path: "opportunities", input: { name: `${prefix} Opportunity`, stage: "PROPOSAL", value: 5000000, probability: 55, expectedCloseDate: new Date().toISOString(), ownerId: salesId, customerId }, update: { stage: "NEGOTIATION" } },
    { path: "activities", input: { subject: `${prefix} Activity`, type: "CALL", status: "PLANNED", dueAt: new Date().toISOString(), ownerId: salesId, customerId }, update: { status: "COMPLETED" } },
  ];
  for (const scenario of scenarios) {
    const created = await request(app).post(`/${scenario.path}`).set(headers()).send(scenario.input).expect(201);
    const id = created.body.id;
    await request(app).get(`/${scenario.path}/${id}`).set(headers()).expect(200);
    const listed = await request(app).get(`/${scenario.path}?search=${prefix}`).set(headers()).expect(200);
    assert.ok(listed.body.data.some((row: { id: string }) => row.id === id));
    const updated = await request(app).put(`/${scenario.path}/${id}`).set(headers()).send({ ...scenario.input, ...scenario.update }).expect(200);
    for (const [key, value] of Object.entries(scenario.update)) assert.equal(updated.body[key], value);
    await request(app).delete(`/${scenario.path}/${id}`).set(headers()).expect(204);
    await request(app).get(`/${scenario.path}/${id}`).set(headers()).expect(404);
  }
  await request(app).post("/activities").set(headers()).send({ ...scenarios[3]!.input, opportunityId: "missing" }).expect(400);
  await request(app).get("/leads?status=INVALID").set(headers()).expect(400);
});

test("lead and opportunity product choices validate the catalog and preserve existing selections", async () => {
  const product = await db.product.findUniqueOrThrow({ where: { id: productId } });
  const inactive = await db.product.create({ data: { ...productInput(), sku: `${prefix}-INACTIVE`, active: false } });
  for (const path of ["leads", "opportunities"]) {
    const input = path === "leads"
      ? { name: `${prefix} Product lead`, phone: "+6281234567890", source: "WEBSITE", status: "NEW", ownerId: salesId }
      : { name: `${prefix} Product deal`, stage: "PROPOSAL", value: 5000000, probability: 55, expectedCloseDate: new Date().toISOString(), ownerId: salesId, customerId };
    const asSales = { Authorization: `Bearer ${salesToken}` };
    for (const invalidId of ["missing-product", inactive.id]) {
      await request(app).post(`/${path}`).set(asSales).send({ ...input, productId: invalidId }).expect(400);
    }
    const created = (await request(app).post(`/${path}`).set(asSales).send({ ...input, productId }).expect(201)).body;
    const detail = (await request(app).get(`/${path}/${created.id}`).set(asSales).expect(200)).body;
    assert.equal(detail.product.id, productId);
    assert.equal(detail.product.name, product.name);
    if (path === "leads") assert.equal(detail.interest, product.name);
    await db.product.update({ where: { id: productId }, data: { active: false } });
    await request(app).put(`/${path}/${created.id}`).set(asSales).send({ ...input, productId }).expect(200);
    await request(app).put(`/${path}/${created.id}`).set(asSales).send({ ...input, productId: inactive.id }).expect(400);
    await request(app).put(`/${path}/${created.id}`).set(asSales).send({ ...input, productId: null }).expect(200);
    const cleared = (await request(app).get(`/${path}/${created.id}`).set(asSales).expect(200)).body;
    assert.equal(cleared.productId, null);
    if (path === "leads") assert.equal(cleared.interest, null);
    await request(app).delete(`/${path}/${created.id}`).set(headers()).expect(204);
    await db.product.update({ where: { id: productId }, data: { active: true } });
  }
  const legacy = { name: `${prefix} Legacy interest`, phone: "+6281234567890", source: "WEBSITE", status: "NEW", ownerId: salesId, interest: "Previous free-text interest" };
  const created = (await request(app).post("/leads").set(headers()).send(legacy).expect(201)).body;
  const updated = (await request(app).put(`/leads/${created.id}`).set(headers()).send({ ...legacy, notes: "Other edit" }).expect(200)).body;
  assert.equal(updated.interest, legacy.interest);
  await request(app).delete(`/leads/${created.id}`).set(headers()).expect(204);
});

test("products and users implement CRUD; account updates revoke tokens", async () => {
  const product = await request(app).post("/products").set("Authorization", `Bearer ${managerToken}`).send({ ...productInput(), sku: `${prefix}-EXTRA` }).expect(201);
  await request(app).get(`/products/${product.body.id}`).set(headers()).expect(200);
  await request(app).put(`/products/${product.body.id}`).set(headers()).send({ ...productInput(), sku: `${prefix}-EXTRA`, stock: 20 }).expect(200);
  await request(app).delete(`/products/${product.body.id}`).set(headers()).expect(204);
  const input = { name: `${prefix} Extra User`, email: `${prefix}-extra@example.com`, password, role: "SALES", active: true };
  const user = await request(app).post("/users").set(headers()).send(input).expect(201);
  await request(app).get(`/users/${user.body.id}`).set(headers()).expect(200);
  const loggedIn = await request(app).post("/auth/login").send({ email: input.email, password }).expect(200);
  await request(app).put(`/users/${user.body.id}`).set(headers()).send({ ...input, active: false }).expect(200);
  await request(app).get("/auth/me").set("Authorization", `Bearer ${loggedIn.body.token}`).expect(401);
  await request(app).delete(`/users/${user.body.id}`).set(headers()).expect(204);
  await request(app).delete(`/users/${adminId}`).set(headers()).expect(400);
  await request(app).put(`/users/${adminId}`).set(headers()).send({ name: `${prefix} Admin`, email: `${prefix}-admin@example.com`, role: "SALES", active: true }).expect(400);
});

test("sales calculate totals, preserve price snapshots, and reconcile inventory on every status transition", async () => {
  const created = await request(app).post("/transactions").set(headers()).send(saleInput(2)).expect(201);
  const id = created.body.id;
  assert.equal(Number(created.body.total), 2000000);
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: productId } })).stock, 8);
  await request(app).get(`/transactions/${id}`).set(headers()).expect(200);
  await request(app).delete(`/products/${productId}`).set(headers()).expect(409);
  await request(app).delete(`/customers/${customerId}`).set(headers()).expect(409);
  await db.product.update({ where: { id: productId }, data: { price: 1500000 } });
  const updated = await request(app).put(`/transactions/${id}`).set(headers()).send(saleInput(3)).expect(200);
  assert.equal(Number(updated.body.total), 3000000);
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: productId } })).stock, 7);
  await request(app).put(`/transactions/${id}`).set(headers()).send(saleInput(3, "PENDING")).expect(200);
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: productId } })).stock, 10);
  await request(app).put(`/transactions/${id}`).set(headers()).send(saleInput(3, "CANCELLED")).expect(200);
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: productId } })).stock, 10);
  await request(app).put(`/transactions/${id}`).set(headers()).send(saleInput(2)).expect(200);
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: productId } })).stock, 8);
  await request(app).delete(`/transactions/${id}`).set(headers()).expect(204);
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: productId } })).stock, 10);
  await db.product.update({ where: { id: productId }, data: { price: 1000000 } });
});

test("out-of-stock and invalid sales roll back without inventory or transaction side effects", async () => {
  const before = await db.salesTransaction.count();
  await request(app).post("/transactions").set(headers()).send(saleInput(11)).expect(409);
  await request(app).post("/transactions").set(headers()).send({ ...saleInput(), total: 1 }).expect(400);
  await request(app).post("/transactions").set(headers()).send({ ...saleInput(), items: [{ productId, quantity: 1 }, { productId, quantity: 1 }] }).expect(400);
  assert.equal(await db.salesTransaction.count(), before);
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: productId } })).stock, 10);
  const created = await request(app).post("/transactions").set(headers()).send(saleInput(2)).expect(201);
  await request(app).put(`/transactions/${created.body.id}`).set(headers()).send(saleInput(20)).expect(409);
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: productId } })).stock, 8);
  assert.equal(Number((await db.salesTransaction.findUniqueOrThrow({ where: { id: created.body.id } })).total), 2000000);
  await request(app).delete(`/transactions/${created.body.id}`).set(headers()).expect(204);
});

test("concurrent checkout cannot oversell the last unit", async () => {
  await db.product.update({ where: { id: productId }, data: { stock: 1 } });
  const responses = await Promise.all([
    request(app).post("/transactions").set(headers()).send(saleInput()),
    request(app).post("/transactions").set(headers()).send(saleInput()),
  ]);
  assert.deepEqual(responses.map(r => r.status).sort(), [201, 409]);
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: productId } })).stock, 0);
  const successful = responses.find(r => r.status === 201)!;
  await request(app).delete(`/transactions/${successful.body.id}`).set(headers()).expect(204);
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: productId } })).stock, 1);
  await db.product.update({ where: { id: productId }, data: { stock: 10 } });
});

test("multi-product checkout rolls back all items when one product is unavailable", async () => {
  const second = await db.product.create({ data: { ...productInput(), sku: `${prefix}-EMPTY`, stock: 0 } });
  const before = await db.salesTransaction.count();
  await request(app).post("/transactions").set(headers()).send({
    ...saleInput(), items: [{ productId, quantity: 1 }, { productId: second.id, quantity: 1 }],
  }).expect(409);
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: productId } })).stock, 10);
  assert.equal(await db.salesTransaction.count(), before);
  await db.product.update({ where: { id: second.id }, data: { active: false, stock: 2 } });
  await request(app).post("/transactions").set(headers()).send({ ...saleInput(), items: [{ productId: second.id, quantity: 1 }] }).expect(400);
  await db.product.delete({ where: { id: second.id } });
});

test("dashboard counts completed sales only, honors month boundaries and excludes closed pipeline stages", async () => {
  const baseline = (await request(app).get("/dashboard").set(headers()).expect(200)).body;
  const current = await request(app).post("/transactions").set(headers()).send(saleInput(2)).expect(201);
  const pending = await request(app).post("/transactions").set(headers()).send(saleInput(3, "PENDING")).expect(201);
  const cancelled = await request(app).post("/transactions").set(headers()).send(saleInput(3, "CANCELLED")).expect(201);
  const previous = await request(app).post("/transactions").set(headers()).send({ ...saleInput(), soldAt: monthStart(new Date(), -1).toISOString() }).expect(201);
  const open = await db.opportunity.create({ data: { name: `${prefix} Open`, stage: "PROPOSAL", value: 4000000, probability: 50, expectedCloseDate: new Date(), customerId, ownerId: salesId } });
  const won = await db.opportunity.create({ data: { name: `${prefix} Won`, stage: "WON", value: 9000000, probability: 100, expectedCloseDate: new Date(), customerId, ownerId: salesId } });
  const dashboard = (await request(app).get("/dashboard").set(headers()).expect(200)).body;
  assert.equal(dashboard.revenueThisMonth - baseline.revenueThisMonth, 2000000);
  assert.equal(dashboard.revenueLastMonth - baseline.revenueLastMonth, 1000000);
  assert.equal(dashboard.pipelineValue - baseline.pipelineValue, 4000000);
  assert.equal(dashboard.totalOpportunities - baseline.totalOpportunities, 2);
  assert.equal(dashboard.monthly.length, 3);
  assert.equal(dashboard.monthly[2].revenue, dashboard.revenueThisMonth);
  assert.equal(dashboard.customerStatuses.reduce((sum: number, row: { count: number }) => sum + row.count, 0), dashboard.totalCustomers);
  assert.equal(dashboard.outcomes.reduce((sum: number, row: { count: number }) => sum + row.count, 0), dashboard.totalOpportunities);
  assert.equal(dashboard.branchPerformance.reduce((sum: number, row: { revenue: number }) => sum + row.revenue, 0),
    dashboard.monthly.reduce((sum: number, row: { revenue: number }) => sum + row.revenue, 0));
  assert.equal(dashboard.weekly.reduce((sum: number, row: { revenue: number }) => sum + row.revenue, 0),
    dashboard.monthly.reduce((sum: number, row: { revenue: number }) => sum + row.revenue, 0));
  assert.equal(dashboard.completedSalesThisMonth - baseline.completedSalesThisMonth, 1);
  assert.equal(dashboard.totalCustomers, await db.customer.count());
  assert.equal(dashboard.totalLeads, await db.lead.count());
  assert.equal(dashboard.leadSources.reduce((sum: number, source: { count: number }) => sum + source.count, 0), dashboard.totalLeads);
  assert.ok(dashboard.topProducts.length > 0 && dashboard.topProducts.length <= 5);
  assert.ok(dashboard.topSalespeople.length > 0 && dashboard.topSalespeople.length <= 4);
  assert.ok(dashboard.recentActivities.length <= 5);
  for (const ranking of [dashboard.topProducts, dashboard.topSalespeople]) {
    assert.ok(ranking.every((row: { name: string; revenue: number }, index: number) => row.name && row.revenue > 0 && (index === 0 || ranking[index - 1].revenue >= row.revenue)));
  }
  for (const sale of [current, pending, cancelled, previous]) await request(app).delete(`/transactions/${sale.body.id}`).set(headers()).expect(204);
  await db.opportunity.deleteMany({ where: { id: { in: [open.id, won.id] } } });
});
