import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { seedHistoricalData } from "../prisma/historical.js";

const database = process.env.DATABASE_URL;
if (!database || !new URL(database).pathname.endsWith("_test") || process.env.ALLOW_INTEGRATION_TESTS !== "true") {
  throw new Error("Historical tests require a dedicated DATABASE_URL ending in _test and ALLOW_INTEGRATION_TESTS=true.");
}
const db = new PrismaClient();
const anchor = new Date("2026-10-27T04:00:00Z");
const prefix = `history-test-${randomUUID().slice(0, 8)}`;
let userId: string;
let existingCustomerId: string;
let existingProductId: string;
let createdProduct = false;
let loaded = false;
let productSnapshot: string;
let customerSnapshot: string;
let userSnapshot: string;

async function removeOwnedBatch() {
  await db.salesTransaction.deleteMany({ where: { id: { startsWith: "hist-v1-sale-" } } });
  await db.activity.deleteMany({ where: { id: { startsWith: "hist-v1-activity-" } } });
  await db.opportunity.deleteMany({ where: { id: { startsWith: "hist-v1-opportunity-" } } });
  await db.lead.deleteMany({ where: { id: { startsWith: "hist-v1-lead-" } } });
  await db.customer.deleteMany({ where: { id: { startsWith: "hist-v1-customer-" } } });
  await db.product.deleteMany({ where: { id: { startsWith: "hist-v1-product-" } } });
  await db.seedBatch.deleteMany({ where: { id: "retail-history-v1" } });
}

before(async () => {
  assert.equal(await db.seedBatch.count(), 0, "Use a test database without an existing historical batch.");
  assert.equal(await db.product.count({ where: { id: { startsWith: "hist-v1-" } } }), 0, "Historical IDs already exist.");
  const user = await db.user.create({ data: { name: prefix, email: `${prefix}@example.com`, role: "SALES", passwordHash: "fixture-not-a-valid-login-hash" } });
  userId = user.id;
  userSnapshot = JSON.stringify(user);
  const customer = await db.customer.create({ data: {
    name: `${prefix} Existing customer`, email: `${prefix}-customer@example.com`, phone: "+6281234567890", city: "Bandung", ownerId: userId, notes: "Do not overwrite this record.",
  } });
  existingCustomerId = customer.id;
  customerSnapshot = JSON.stringify(customer);
  let product = await db.product.findUnique({ where: { sku: "APL-IP15-128-BLK" } });
  if (!product) {
    product = await db.product.create({ data: { name: "Existing modified catalogue entry", sku: "APL-IP15-128-BLK", brand: "Apple", price: 12345000, stock: 17, active: false } });
    createdProduct = true;
  }
  existingProductId = product.id;
  productSnapshot = JSON.stringify(product);
  await seedHistoricalData(db, anchor);
  loaded = true;
});

after(async () => {
  if (loaded) await removeOwnedBatch();
  if (existingCustomerId) await db.customer.delete({ where: { id: existingCustomerId } });
  if (createdProduct) await db.product.delete({ where: { id: existingProductId } });
  if (userId) await db.user.delete({ where: { id: userId } });
  await db.$disconnect();
});

test("historical batch contains exactly the requested six entity counts", async () => {
  const counts = await Promise.all([
    db.customer.count({ where: { id: { startsWith: "hist-v1-customer-" } } }),
    db.contact.count({ where: { id: { startsWith: "hist-v1-contact-" } } }),
    db.lead.count({ where: { id: { startsWith: "hist-v1-lead-" } } }),
    db.opportunity.count({ where: { id: { startsWith: "hist-v1-opportunity-" } } }),
    db.activity.count({ where: { id: { startsWith: "hist-v1-activity-" } } }),
    db.salesTransaction.count({ where: { id: { startsWith: "hist-v1-sale-" } } }),
  ]);
  assert.deepEqual(counts, [300, 500, 250, 150, 3000, 1000]);
  const batch = await db.seedBatch.findUniqueOrThrow({ where: { id: "retail-history-v1" } });
  assert.equal(batch.periodStart.toISOString(), "2026-08-01T00:00:00.000Z");
  assert.equal(batch.periodEnd.toISOString(), anchor.toISOString());
  assert.ok(batch.createdAt <= new Date(), "Seed audit timestamp must use UTC even if the server timezone is not UTC.");
});

test("existing users, customer details, catalogue prices, and stock balances are preserved", async () => {
  assert.equal(JSON.stringify(await db.user.findUniqueOrThrow({ where: { id: userId } })), userSnapshot);
  assert.equal(JSON.stringify(await db.customer.findUniqueOrThrow({ where: { id: existingCustomerId } })), customerSnapshot);
  assert.equal(JSON.stringify(await db.product.findUniqueOrThrow({ where: { id: existingProductId } })), productSnapshot);
});

test("all branch, acquisition, activity, and opportunity categories are represented", async () => {
  const [branches, sources, types, stages] = await Promise.all([
    db.customer.groupBy({ by: ["branch"], where: { id: { startsWith: "hist-v1-" } }, _count: true }),
    db.lead.groupBy({ by: ["source"], where: { id: { startsWith: "hist-v1-" } }, _count: true }),
    db.activity.groupBy({ by: ["type"], where: { id: { startsWith: "hist-v1-" } }, _count: true }),
    db.opportunity.groupBy({ by: ["stage"], where: { id: { startsWith: "hist-v1-" } }, _count: true }),
  ]);
  assert.deepEqual(branches.map(b => b.branch).sort(), ["BANDUNG", "JAKARTA", "MEDAN", "SEMARANG", "SURABAYA"]);
  assert.ok(branches.every(b => b._count >= 20));
  assert.ok(branches.find(b => b.branch === "JAKARTA")!._count > branches.find(b => b.branch === "SEMARANG")!._count);
  assert.deepEqual(sources.map(s => s.source).sort(), ["FACEBOOK", "INSTAGRAM", "MARKETPLACE", "REFERRAL", "TIKTOK", "WALK_IN", "WEBSITE"]);
  assert.deepEqual(types.map(t => t.type).sort(), ["CALL", "EMAIL", "FOLLOW_UP", "MEETING", "STORE_VISIT", "WHATSAPP"]);
  assert.ok(types.find(t => t.type === "WHATSAPP")!._count > types.find(t => t.type === "EMAIL")!._count);
  assert.deepEqual(stages.map(s => s.stage).sort(), ["LOST", "NEGOTIATION", "PROPOSAL", "PROSPECTING", "QUALIFIED", "WON"]);
});

test("transaction totals and individual prices stay within IDR 2M to 25M with historical price snapshots", async () => {
  const transactions = await db.salesTransaction.findMany({ where: { id: { startsWith: "hist-v1-sale-" } }, include: { items: true, customer: true, opportunity: true } });
  let multiItem = 0;
  for (const transaction of transactions) {
    assert.ok(Number(transaction.total) >= 2000000 && Number(transaction.total) <= 25000000);
    assert.equal(Number(transaction.total), transaction.items.reduce((sum, item) => sum + Number(item.subtotal), 0));
    assert.equal(transaction.branch, transaction.customer.branch);
    assert.ok(transaction.createdAt >= transaction.customer.createdAt);
    assert.ok(transaction.soldAt <= anchor);
    assert.equal(transaction.createdAt.toISOString(), transaction.soldAt.toISOString());
    if (transaction.items.length > 1) multiItem++;
    for (const item of transaction.items) {
      assert.equal(Number(item.subtotal), Number(item.unitPrice) * item.quantity);
      assert.ok(Number(item.unitPrice) >= 2000000 && Number(item.unitPrice) <= 25000000);
    }
    if (transaction.opportunity) {
      assert.equal(transaction.opportunity.stage, "WON");
      assert.equal(transaction.opportunity.customerId, transaction.customerId);
      assert.equal(transaction.opportunity.value.toString(), transaction.total.toString());
      assert.ok(transaction.opportunity.createdAt <= transaction.soldAt);
    }
  }
  assert.ok(multiItem >= 20);
  assert.ok(transactions.some(t => Number(t.total) === 2000000));
  assert.ok(transactions.some(t => Number(t.total) === 25000000));
});

test("sales show a campaign growth month, cooling month, and uneven weekly and daily operations", async () => {
  const months = await db.$queryRaw<{ month: Date; sales: number; revenue: number }[]>`
    SELECT date_trunc('month', "soldAt") AS month, count(*)::int AS sales, sum(total)::float8 AS revenue
    FROM sales_transactions WHERE id LIKE 'hist-v1-sale-%' AND status = 'COMPLETED' GROUP BY 1 ORDER BY 1`;
  assert.equal(months.length, 3);
  assert.ok(months[1]!.sales > months[0]!.sales);
  assert.ok(months[2]!.sales < months[1]!.sales);
  assert.ok(months[1]!.revenue > months[0]!.revenue);
  assert.ok(months[2]!.revenue < months[1]!.revenue);
  const weeks = await db.$queryRaw<{ sales: number }[]>`
    SELECT count(*)::int AS sales FROM sales_transactions WHERE id LIKE 'hist-v1-sale-%'
    GROUP BY date_trunc('week', "soldAt") ORDER BY date_trunc('week', "soldAt")`;
  assert.ok(weeks.some((row, i) => i > 0 && row.sales > weeks[i - 1]!.sales));
  assert.ok(weeks.some((row, i) => i > 0 && row.sales < weeks[i - 1]!.sales));
});

test("inactive customers are dormant and lost deals carry actionable reasons", async () => {
  const inactive = await db.customer.findMany({
    where: { id: { startsWith: "hist-v1-" }, status: "INACTIVE" },
    include: { activities: { where: { status: "COMPLETED" } }, transactions: true },
  });
  const cutoff = new Date(anchor.getTime() - 45 * 86400000);
  assert.equal(inactive.length, 60);
  for (const customer of inactive) {
    assert.ok(customer.activities.every(a => a.dueAt <= cutoff));
    assert.ok(customer.transactions.every(t => t.soldAt <= cutoff));
  }
  const lost = await db.opportunity.findMany({ where: { id: { startsWith: "hist-v1-" }, stage: "LOST" }, include: { transactions: true } });
  assert.equal(lost.length, 35);
  assert.ok(lost.every(o => o.lostReason && o.probability === 0 && o.transactions.length === 0));
});

test("activities retain valid customer/opportunity chronology and realistic status mix", async () => {
  const activities = await db.activity.findMany({
    where: { id: { startsWith: "hist-v1-" } }, include: { customer: true, opportunity: true },
  });
  for (const activity of activities) {
    assert.ok(activity.createdAt <= anchor && activity.updatedAt <= anchor);
    assert.ok(activity.createdAt >= activity.customer!.createdAt);
    assert.ok(activity.dueAt >= activity.createdAt);
    assert.equal(activity.branch, activity.customer!.branch);
    if (activity.status !== "PLANNED") assert.ok(activity.dueAt <= anchor);
    if (activity.opportunity) {
      assert.equal(activity.opportunity.customerId, activity.customerId);
      assert.ok(activity.createdAt >= activity.opportunity.createdAt);
    }
  }
  assert.equal(activities.filter(a => a.status === "PLANNED").length, 150);
  assert.equal(activities.filter(a => a.status === "CANCELLED").length, 90);
});

test("repeated and concurrent seeds do not duplicate or resurrect edited sample records", async () => {
  const id = "hist-v1-customer-0300";
  await db.customer.update({ where: { id }, data: { notes: "User-edited sample record" } });
  const before = await db.salesTransaction.count();
  await Promise.all([seedHistoricalData(db, anchor), seedHistoricalData(db, new Date("2027-01-05T00:00:00Z"))]);
  assert.equal(await db.salesTransaction.count(), before);
  assert.equal((await db.customer.findUniqueOrThrow({ where: { id } })).notes, "User-edited sample record");
  assert.equal((await db.seedBatch.findUniqueOrThrow({ where: { id: "retail-history-v1" } })).periodEnd.toISOString(), anchor.toISOString());
});

test("a fresh seed handles year rollover and an almost-empty current month without future sales", async () => {
  await removeOwnedBatch();
  loaded = false;
  const january = new Date("2027-01-01T00:01:00Z");
  await seedHistoricalData(db, january);
  loaded = true;
  const batch = await db.seedBatch.findUniqueOrThrow({ where: { id: "retail-history-v1" } });
  assert.equal(batch.periodStart.toISOString(), "2026-11-01T00:00:00.000Z");
  assert.equal(await db.salesTransaction.count({ where: { id: { startsWith: "hist-v1-" } } }), 1000);
  assert.equal(await db.salesTransaction.count({ where: { id: { startsWith: "hist-v1-" }, soldAt: { gt: january } } }), 0);
  const dates = await db.$queryRaw<{ invalid: number }[]>`
    SELECT count(*)::int AS invalid FROM (
      SELECT "createdAt" FROM customers WHERE id LIKE 'hist-v1-%'
      UNION ALL SELECT "createdAt" FROM contacts WHERE id LIKE 'hist-v1-%'
      UNION ALL SELECT "createdAt" FROM leads WHERE id LIKE 'hist-v1-%'
      UNION ALL SELECT "createdAt" FROM opportunities WHERE id LIKE 'hist-v1-%'
      UNION ALL SELECT "createdAt" FROM activities WHERE id LIKE 'hist-v1-%'
    ) records WHERE "createdAt" < '2026-11-01'::timestamp OR "createdAt" > '2027-01-01T00:01:00'::timestamp`;
  assert.equal(dates[0]!.invalid, 0);
});
