import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "./db.js";
import { publicUser } from "./auth.js";
import { allow, asyncRoute, HttpError, listQuery, principal } from "./http.js";
import { pagination } from "./crud.js";
import { userCreateSchema, userUpdateSchema } from "./schemas.js";
import { serializable } from "./transactions.js";

export const usersRouter = Router();
usersRouter.use(allow("ADMIN"));
usersRouter.get("/", asyncRoute(async (req, res) => {
  const q = listQuery.parse(req.query);
  const where: Prisma.UserWhereInput = { OR: [{ name: { contains: q.search, mode: "insensitive" } }, { email: { contains: q.search, mode: "insensitive" } }] };
  const [data, total] = await db.$transaction([
    db.user.findMany({ where, ...pagination(q), select: publicUser }), db.user.count({ where }),
  ]);
  res.json({ data, total, page: q.page, pageSize: q.pageSize, totalPages: Math.ceil(total / q.pageSize) });
}));
usersRouter.get("/:id", asyncRoute(async (req, res) => {
  const user = await db.user.findUnique({ where: { id: req.params.id }, select: publicUser });
  if (!user) throw new HttpError(404, "User not found.");
  res.json(user);
}));
usersRouter.post("/", asyncRoute(async (req, res) => {
  const { password, ...data } = userCreateSchema.parse(req.body);
  res.status(201).json(await db.user.create({ data: { ...data, passwordHash: await bcrypt.hash(password, 12) }, select: publicUser }));
}));
usersRouter.put("/:id", asyncRoute(async (req, res) => {
  const id = z.string().min(1).parse(req.params.id);
  const { password, ...data } = userUpdateSchema.parse(req.body);
  if (id === principal(req).id && (!data.active || data.role !== "ADMIN")) throw new HttpError(400, "You cannot disable or demote your own account.");
  const passwordHash = password ? await bcrypt.hash(password, 12) : undefined;
  const result = await serializable(async tx => {
    const existing = await tx.user.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "User not found.");
    if (existing.role === "ADMIN" && existing.active && (!data.active || data.role !== "ADMIN")) {
      if (await tx.user.count({ where: { role: "ADMIN", active: true } }) <= 1) throw new HttpError(400, "At least one active administrator is required.");
    }
    return tx.user.update({ where: { id }, data: { ...data, passwordHash }, select: publicUser });
  });
  res.json(result);
}));
usersRouter.delete("/:id", asyncRoute(async (req, res) => {
  const id = z.string().min(1).parse(req.params.id);
  if (id === principal(req).id) throw new HttpError(400, "You cannot delete your own account.");
  await serializable(async tx => {
    const user = await tx.user.findUnique({ where: { id } });
    if (!user) throw new HttpError(404, "User not found.");
    if (user.role === "ADMIN" && user.active && await tx.user.count({ where: { role: "ADMIN", active: true } }) <= 1) {
      throw new HttpError(400, "At least one active administrator is required.");
    }
    await tx.user.delete({ where: { id } });
  });
  res.status(204).end();
}));
