import { Prisma, Role } from "@prisma/client";
import type { ErrorRequestHandler, Request, RequestHandler } from "express";
import { ZodError, z } from "zod";

export type Principal = { id: string; name: string; email: string; role: Role };

declare global {
  namespace Express {
    interface Request { user?: Principal }
  }
}

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export const asyncRoute = (fn: RequestHandler): RequestHandler => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

export function principal(req: Request): Principal {
  if (!req.user) throw new HttpError(401, "Please sign in to continue.");
  return req.user;
}

export const allow = (...roles: Role[]): RequestHandler => (req, _res, next) => {
  if (!roles.includes(principal(req).role)) return next(new HttpError(403, "Your role does not allow this action."));
  next();
};

export const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().trim().max(200).default(""),
  status: z.string().max(60).optional(),
});

export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  if (error instanceof ZodError) {
    res.status(400).json({ message: "Please check the submitted fields.", errors: error.flatten() });
    return;
  }
  if (error instanceof HttpError) {
    res.status(error.status).json({ message: error.message });
    return;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      res.status(409).json({ message: "A record with this email, SKU, or unique identifier already exists." });
      return;
    }
    if (error.code === "P2025") {
      res.status(404).json({ message: "This record no longer exists." });
      return;
    }
    if (error.code === "P2003") {
      res.status(409).json({ message: "A linked record is missing, or this record is still in use. Remove its dependencies first." });
      return;
    }
    if (error.code === "P2034") {
      res.status(409).json({ message: "Another update conflicted with this action. Please retry." });
      return;
    }
  }
  if (error instanceof SyntaxError && "body" in error) {
    res.status(400).json({ message: "The request body must be valid JSON." });
    return;
  }
  if (error instanceof Error && "type" in error && error.type === "entity.too.large") {
    res.status(413).json({ message: "The request body is too large." });
    return;
  }
  console.error("Request failed:", error);
  res.status(500).json({ message: "An unexpected error occurred. Please try again." });
};
