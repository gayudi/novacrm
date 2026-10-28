import assert from "node:assert/strict";
import { test } from "node:test";
import request from "supertest";
import jwt from "jsonwebtoken";
import { createApp } from "../src/app.js";

const app = createApp();

test("guest sign-in creates signed, expiring read-only sessions without credentials or database users", async () => {
  const first = await request(app).post("/auth/guest").send({}).expect(200);
  const second = await request(app).post("/auth/guest").send({}).expect(200);
  assert.equal(first.body.user.role, "GUEST");
  assert.equal(first.body.user.name, "Guest");
  assert.notEqual(first.body.user.id, second.body.user.id);
  const claims = jwt.decode(first.body.token);
  assert.ok(claims && typeof claims !== "string");
  assert.equal(claims.sessionType, "guest");
  assert.equal(claims.exp! - claims.iat!, 7200);
  assert.equal(claims.iss, "nova-crm");
  assert.equal(claims.aud, "nova-web");
  const me = await request(app).get("/auth/me").auth(first.body.token, { type: "bearer" }).expect(200);
  assert.deepEqual(me.body, first.body.user);
  await request(app).post("/auth/guest").send({ role: "ADMIN" }).expect(400);
  await request(app).get("/auth/me").auth(`${first.body.token}tampered`, { type: "bearer" }).expect(401);
});

test("guests cannot mutate any CRM resource, convert leads or manage users via direct API requests", async () => {
  const { body: { token } } = await request(app).post("/auth/guest").send({}).expect(200);
  const paths = ["customers", "contacts", "leads", "opportunities", "activities", "products", "transactions", "users"];
  for (const resource of paths) {
    for (const method of ["post", "put", "patch", "delete"] as const) {
      const path = method === "post" ? `/${resource}` : `/${resource}/missing`;
      const response = await request(app)[method](path).auth(token, { type: "bearer" }).send({}).expect(403);
      assert.match(response.body.message, /read-only/);
    }
  }
  await request(app).post("/leads/missing/convert").auth(token, { type: "bearer" }).send({}).expect(403);
  await request(app).get("/users").auth(token, { type: "bearer" }).expect(403);
  await request(app).post("/copilot/chat/unknown").auth(token, { type: "bearer" }).send({}).expect(403);
});

test("guest can access company-wide Copilot but only the read-only chat POST is allowed", async () => {
  const { body: { token } } = await request(app).post("/auth/guest").send({}).expect(200);
  const status = await request(app).get("/copilot/status").auth(token, { type: "bearer" }).expect(200);
  assert.equal(status.body.scope, "company");
  // Invalid input reaches the chat validator, not a write handler or a database query.
  await request(app).post("/copilot/chat").auth(token, { type: "bearer" }).send({ unexpected: true }).expect(400);
  await request(app).delete("/copilot/chat").auth(token, { type: "bearer" }).expect(403);
  await request(app).post("/copilot/chat").send({}).expect(401);
});
