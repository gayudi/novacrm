import assert from "node:assert/strict";
import { test } from "node:test";
import { activitySchema, customerSchema, loginSchema, opportunitySchema, productSchema, transactionSchema, userCreateSchema } from "../src/schemas.js";
import { listQuery } from "../src/http.js";
import { monthStart } from "../src/dashboard.js";
import { transactionPeriod } from "../src/transactions.js";

test("login normalizes email and rejects unknown properties", () => {
  assert.equal(loginSchema.parse({ email: " ADMIN@EXAMPLE.COM ", password: "example" }).email, "admin@example.com");
  assert.equal(loginSchema.safeParse({ email: "admin@example.com", password: "x", role: "ADMIN" }).success, false);
});
test("customer accepts an empty optional email but requires a valid phone", () => {
  const customer = { name: "Test Customer", email: "", phone: "+62 812 1234 5678", city: "Jakarta", ownerId: "owner" };
  assert.equal(customerSchema.parse(customer).email, null);
  assert.equal(customerSchema.safeParse({ ...customer, phone: "not a phone" }).success, false);
  assert.equal(customerSchema.safeParse({ ...customer, segment: "INVALID" }).success, false);
});
test("product prices and stock have explicit bounds", () => {
  const product = { name: "Test Phone", sku: "TEST-PHONE", brand: "Test", price: 100, stock: 5 };
  assert.equal(productSchema.safeParse(product).success, true);
  for (const changes of [{ price: -1 }, { price: 0 }, { price: 1e15 }, { price: 1.001 }, { stock: -1 }, { stock: 1.5 }]) {
    assert.equal(productSchema.safeParse({ ...product, ...changes }).success, false);
  }
});
test("transaction validation rejects duplicate products, empty carts, zero quantities, and supplied totals", () => {
  const transaction = { customerId: "customer", salespersonId: "sales", status: "COMPLETED", soldAt: new Date().toISOString(), items: [{ productId: "phone", quantity: 1 }] };
  assert.equal(transactionSchema.safeParse(transaction).success, true);
  for (const changes of [
    { items: [] }, { items: [{ productId: "phone", quantity: 0 }] },
    { items: [{ productId: "phone", quantity: 1 }, { productId: "phone", quantity: 2 }] },
    { total: 1 }, { items: [{ productId: "phone", quantity: 1, unitPrice: 1 }] },
  ]) assert.equal(transactionSchema.safeParse({ ...transaction, ...changes }).success, false);
});
test("opportunity probability and activity dates are validated", () => {
  const opportunity = { name: "Phone upgrade", stage: "PROPOSAL", value: 10000000, probability: 55, expectedCloseDate: new Date().toISOString(), customerId: "customer", ownerId: "owner" };
  assert.equal(opportunitySchema.safeParse(opportunity).success, true);
  assert.equal(opportunitySchema.safeParse({ ...opportunity, probability: 101 }).success, false);
  assert.equal(activitySchema.safeParse({ subject: "Call customer", type: "CALL", status: "PLANNED", dueAt: "not a date", ownerId: "owner" }).success, false);
});
test("pagination rejects invalid and excessive page sizes", () => {
  assert.deepEqual(listQuery.parse({}), { page: 1, pageSize: 10, search: "" });
  assert.equal(listQuery.safeParse({ page: 0 }).success, false);
  assert.equal(listQuery.safeParse({ pageSize: 101 }).success, false);
});
test("user passwords require at least twelve characters", () => {
  assert.equal(userCreateSchema.safeParse({ name: "Test User", email: "test@example.com", password: "short", role: "ADMIN" }).success, false);
  assert.equal(userCreateSchema.safeParse({ name: "Test User", email: "test@example.com", password: "\u00e9".repeat(37), role: "ADMIN" }).success, false);
});
test("dashboard calendar boundaries use UTC and roll over years correctly", () => {
  const date = new Date("2026-01-31T23:59:59Z");
  assert.equal(monthStart(date).toISOString(), "2026-01-01T00:00:00.000Z");
  assert.equal(monthStart(date, -1).toISOString(), "2025-12-01T00:00:00.000Z");
  assert.equal(monthStart(date, 1).toISOString(), "2026-02-01T00:00:00.000Z");
});

test("transaction calendar filters use WIB with inclusive starts and exclusive ends", () => {
  const range = (period: "week" | "month" | "quarter", now: string) => {
    const dates = transactionPeriod(period, new Date(now))!;
    return [dates.gte.toISOString(), dates.lt.toISOString()];
  };
  assert.equal(transactionPeriod("all"), undefined);
  assert.deepEqual(range("week", "2026-10-25T16:59:59Z"), ["2026-10-18T17:00:00.000Z", "2026-10-25T17:00:00.000Z"]);
  assert.deepEqual(range("week", "2026-10-25T17:00:00Z"), ["2026-10-25T17:00:00.000Z", "2026-11-01T17:00:00.000Z"]);
  assert.deepEqual(range("month", "2026-10-31T17:00:00Z"), ["2026-10-31T17:00:00.000Z", "2026-11-30T17:00:00.000Z"]);
  assert.deepEqual(range("month", "2028-02-15T00:00:00Z"), ["2028-01-31T17:00:00.000Z", "2028-02-29T17:00:00.000Z"]);
  assert.deepEqual(range("quarter", "2026-10-27T10:00:00Z"), ["2026-09-30T17:00:00.000Z", "2026-12-31T17:00:00.000Z"]);
  assert.deepEqual(range("quarter", "2026-12-31T17:00:00Z"), ["2026-12-31T17:00:00.000Z", "2027-03-31T17:00:00.000Z"]);
  assert.deepEqual(range("week", "2026-01-01T00:00:00Z"), ["2025-12-28T17:00:00.000Z", "2026-01-04T17:00:00.000Z"]);
});
