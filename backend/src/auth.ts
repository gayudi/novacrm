import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { rateLimit } from "express-rate-limit";
import { db } from "./db.js";
import { config } from "./config.js";
import { asyncRoute, HttpError, principal } from "./http.js";
import { loginSchema } from "./schemas.js";

export const publicUser = { id: true, name: true, email: true, role: true, active: true, createdAt: true, updatedAt: true } as const;
const jwtOptions = { issuer: "nova-crm", audience: "nova-web" };
const dummyHash = bcrypt.hashSync("constant-time-invalid-login", 12);

export const authenticate = asyncRoute(async (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) throw new HttpError(401, "Please sign in to continue.");
  let payload: jwt.JwtPayload;
  try {
    const decoded = jwt.verify(header.slice(7), config.jwtSecret, { ...jwtOptions, algorithms: ["HS256"] });
    if (typeof decoded === "string" || !decoded.sub) throw new Error("Invalid token");
    payload = decoded;
  } catch {
    throw new HttpError(401, "Your session has expired. Please sign in again.");
  }
  if (payload.sessionType === "guest" && payload.sub?.startsWith("guest:")) {
    req.user = { id: payload.sub, name: "Guest", email: "", role: "GUEST" };
    next();
    return;
  }
  const user = await db.user.findUnique({ where: { id: payload.sub }, select: publicUser });
  if (!user?.active || payload.version !== user.updatedAt.toISOString()) {
    throw new HttpError(401, "Your account or session has changed. Please sign in again.");
  }
  req.user = { id: user.id, name: user.name, email: user.email, role: user.role };
  next();
});

export const authRouter = Router();
authRouter.get("/config", (_req, res) => {
  res.json({ demo: config.ENABLE_DEMO_DATA === "true", adminEmail: config.ENABLE_DEMO_DATA === "true" ? config.ADMIN_EMAIL : undefined });
});
authRouter.post("/guest", rateLimit({
  windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: "draft-7", legacyHeaders: false,
  message: { message: "Too many guest sign-in attempts. Please try again in 15 minutes." },
}), asyncRoute(async (req, res) => {
  z.object({}).strict().parse(req.body ?? {});
  const user = { id: `guest:${randomUUID()}`, name: "Guest", email: "", role: "GUEST" as const };
  const token = jwt.sign({ sessionType: "guest" }, config.jwtSecret, {
    ...jwtOptions, subject: user.id, algorithm: "HS256", expiresIn: "2h",
  });
  res.json({ token, user });
}));
authRouter.post("/login", rateLimit({
  windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: "draft-7", legacyHeaders: false,
  message: { message: "Too many sign-in attempts. Please try again in 15 minutes." },
}), asyncRoute(async (req, res) => {
  const input = loginSchema.parse(req.body);
  const user = await db.user.findUnique({ where: { email: input.email } });
  const matches = await bcrypt.compare(input.password, user?.passwordHash ?? dummyHash);
  if (!user?.active || !matches) throw new HttpError(401, "The email or password is incorrect.");
  const token = jwt.sign({ version: user.updatedAt.toISOString() }, config.jwtSecret, {
    ...jwtOptions, subject: user.id, algorithm: "HS256", expiresIn: "8h",
  });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
}));
authRouter.get("/me", authenticate, (req, res) => res.json(principal(req)));
