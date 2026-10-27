import { Router } from "express";
import { z } from "zod";
import { db } from "./db.js";
import { customerScope, leadScope } from "./access.js";
import { pagination } from "./crud.js";
import { asyncRoute, HttpError, listQuery, principal } from "./http.js";
import { customerSchema, leadConversionSchema } from "./schemas.js";
import { serializable } from "./transactions.js";

export const leadConversionRouter = Router();

leadConversionRouter.get("/:id/conversion-customers", asyncRoute(async (req, res) => {
  const user = principal(req);
  const lead = await db.lead.findFirst({ where: { ...leadScope(user), id: req.params.id } });
  if (!lead) throw new HttpError(404, "Lead tidak ditemukan.");
  const q = listQuery.parse(req.query);
  const where = {
    AND: [customerScope(user), { ownerId: lead.ownerId }],
    OR: ["name", "email", "phone"].map(key => ({ [key]: { contains: q.search, mode: "insensitive" as const } })),
  };
  const [data, total] = await db.$transaction([
    db.customer.findMany({ where, ...pagination(q), orderBy: [{ name: "asc" }, { id: "asc" }], select: { id: true, name: true, email: true, phone: true, city: true, status: true } }),
    db.customer.count({ where }),
  ]);
  res.json({ data, total, page: q.page, pageSize: q.pageSize, totalPages: Math.ceil(total / q.pageSize) });
}));

leadConversionRouter.post("/:id/convert", asyncRoute(async (req, res) => {
  const id = z.string().min(1).parse(req.params.id);
  const input = leadConversionSchema.parse(req.body);
  const user = principal(req);
  const result = await serializable(async tx => {
    const lead = await tx.lead.findFirst({ where: { ...leadScope(user), id } });
    if (!lead) throw new HttpError(404, "Lead tidak ditemukan.");
    if (lead.convertedAt || lead.convertedOpportunityId) throw new HttpError(409, "Lead sudah dikonversi. Muat ulang daftar untuk membuka opportunity yang telah dibuat.");
    if (lead.updatedAt.getTime() !== new Date(input.expectedUpdatedAt).getTime()) throw new HttpError(409, "Lead telah berubah. Tutup formulir, muat ulang daftar, lalu periksa datanya kembali.");
    if (lead.status !== "QUALIFIED" && !(lead.status === "CONVERTED" && input.confirmLegacy)) {
      throw new HttpError(409, lead.status === "CONVERTED"
        ? "Konfirmasi pemeriksaan riwayat diperlukan untuk lead Converted lama."
        : "Hanya lead Qualified yang dapat dikonversi. Kualifikasi lead terlebih dahulu.");
    }
    if (!await tx.user.findFirst({ where: { id: lead.ownerId, active: true } })) throw new HttpError(409, "Pemilik lead tidak aktif. Aktifkan atau alihkan lead ke sales aktif terlebih dahulu.");

    let customerId: string;
    if (input.customer.mode === "existing") {
      const customer = await tx.customer.findFirst({
        where: { AND: [customerScope(user), { id: input.customer.customerId, ownerId: lead.ownerId }] },
        select: { id: true },
      });
      if (!customer) throw new HttpError(404, "Customer tidak tersedia untuk pemilik lead ini. Pilih customer dengan pemilik yang sama.");
      customerId = customer.id;
    } else {
      const data = customerSchema.parse({
        name: lead.name, email: lead.email, phone: lead.phone, city: input.customer.city,
        ownerId: lead.ownerId, branch: lead.branch, notes: lead.notes,
      });
      // Indonesian local 08... and international +628... represent the same number.
      const phone = data.phone.replace(/\D/g, "").replace(/^0/, "62");
      const matches = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM customers
        WHERE (email IS NOT NULL AND lower(email) = ${data.email ?? null})
          OR regexp_replace(regexp_replace(phone, '[^0-9]', '', 'g'), '^0', '62') = ${phone}
        LIMIT 1`;
      if (matches.length) throw new HttpError(409, "Customer dengan email atau nomor telepon ini sudah ada. Pilih customer yang tersedia, atau minta Admin/Manager memeriksa kepemilikannya.");
      customerId = (await tx.customer.create({ data, select: { id: true } })).id;
    }
    const opportunity = await tx.opportunity.create({
      data: {
        ...input.opportunity, stage: "QUALIFIED", customerId, ownerId: lead.ownerId,
        branch: lead.branch, notes: lead.notes,
      },
      select: { id: true, name: true, customerId: true },
    });
    const converted = await tx.lead.update({
      where: { id },
      data: { status: "CONVERTED", customerId, convertedOpportunityId: opportunity.id, convertedAt: new Date() },
      select: { id: true, status: true, convertedAt: true, convertedOpportunityId: true },
    });
    return { lead: converted, opportunity, customerId };
  });
  res.status(201).json(result);
}));
