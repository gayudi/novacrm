import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { db } from "./db.js";
import { authenticate, authRouter } from "./auth.js";
import { asyncRoute, enforceGuestReadOnly, errorHandler } from "./http.js";
import { resources } from "./resources.js";
import { transactionsRouter } from "./transactions.js";
import { usersRouter } from "./users.js";
import { dashboardRouter } from "./dashboard.js";
import { createCopilotRouter } from "./copilot.js";
import type { Completion } from "./azure.js";

export function createApp(options: { copilotComplete?: Completion } = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(express.json({ limit: "256kb" }));
  app.get("/health", asyncRoute(async (_req, res) => {
    await db.$queryRaw`SELECT 1`;
    res.json({ status: "ok" });
  }));
  app.use(rateLimit({ windowMs: 60_000, limit: 500, standardHeaders: "draft-7", legacyHeaders: false, message: { message: "Too many requests. Please try again shortly." } }));
  app.use("/auth", authRouter);
  app.use(authenticate);
  app.use(enforceGuestReadOnly);
  app.use("/dashboard", dashboardRouter);
  app.use(resources);
  app.use("/transactions", transactionsRouter);
  app.use("/users", usersRouter);
  app.use("/copilot", createCopilotRouter(options.copilotComplete));
  app.use((_req, res) => res.status(404).json({ message: "API endpoint not found." }));
  app.use(errorHandler);
  return app;
}
export const app = createApp();
