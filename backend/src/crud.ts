import { Router } from "express";
import type { Request } from "express";
import { Role } from "@prisma/client";
import { z } from "zod";
import { allow, asyncRoute, HttpError, listQuery } from "./http.js";

export type ListInput = z.infer<typeof listQuery>;
type Repository<T> = {
  list: (query: ListInput, req: Request) => Promise<{ data: unknown[]; total: number }>;
  get: (id: string, req: Request) => Promise<unknown | null>;
  create: (data: T, req: Request) => Promise<unknown>;
  update: (id: string, data: T, req: Request) => Promise<unknown>;
  remove: (id: string, req: Request) => Promise<unknown>;
};

export function crud<T>(
  schema: z.ZodType<T, unknown>,
  repo: Repository<T>,
  writers: Role[] = ["ADMIN", "MANAGER", "SALES"],
): Router {
  const router = Router();
  router.get("/", asyncRoute(async (req, res) => {
    const query = listQuery.parse(req.query);
    const result = await repo.list(query, req);
    res.json({ ...result, page: query.page, pageSize: query.pageSize, totalPages: Math.ceil(result.total / query.pageSize) });
  }));
  router.get("/:id", asyncRoute(async (req, res) => {
    const data = await repo.get(z.string().min(1).parse(req.params.id), req);
    if (!data) throw new HttpError(404, "Record not found.");
    res.json(data);
  }));
  router.post("/", allow(...writers), asyncRoute(async (req, res) => {
    res.status(201).json(await repo.create(schema.parse(req.body), req));
  }));
  router.put("/:id", allow(...writers), asyncRoute(async (req, res) => {
    res.json(await repo.update(z.string().min(1).parse(req.params.id), schema.parse(req.body), req));
  }));
  router.delete("/:id", allow("ADMIN", "MANAGER"), asyncRoute(async (req, res) => {
    await repo.remove(z.string().min(1).parse(req.params.id), req);
    res.status(204).end();
  }));
  return router;
}

export const pagination = (query: ListInput) => ({
  skip: (query.page - 1) * query.pageSize, take: query.pageSize, orderBy: { createdAt: "desc" as const },
});
