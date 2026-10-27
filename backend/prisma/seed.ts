import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { userCreateSchema } from "../src/schemas.js";
import { seedHistoricalData } from "./historical.js";

const db = new PrismaClient();
const demo = process.env.ENABLE_DEMO_DATA === "true";

try {
  await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(27062026)`;
    if (await tx.user.count() > 0) return;
    const email = userCreateSchema.shape.email.parse(process.env.ADMIN_EMAIL ?? "admin@nova.example");
    const password = userCreateSchema.shape.password.parse(process.env.ADMIN_PASSWORD);
    await tx.user.create({ data: {
      name: "Budi Santoso", email, role: "ADMIN", passwordHash: await bcrypt.hash(password, 12),
    } });
    if (!demo) return;
    const managerPassword = userCreateSchema.shape.password.parse(process.env.MANAGER_PASSWORD);
    const salesPassword = userCreateSchema.shape.password.parse(process.env.SALES_PASSWORD);
    const salesHash = await bcrypt.hash(salesPassword, 12);
    await tx.user.create({ data: {
      name: "Maya Putri", email: "manager@nova.example", role: "MANAGER", passwordHash: await bcrypt.hash(managerPassword, 12),
    } });
    await tx.user.createMany({ data: [
      { name: "Rizky Pratama", email: "sales@nova.example", role: "SALES", passwordHash: salesHash },
      { name: "Nadia Safitri", email: "nadia@nova.example", role: "SALES", passwordHash: salesHash },
      { name: "Andi Ramadhan", email: "andi@nova.example", role: "SALES", passwordHash: salesHash },
    ] });
    console.info("Initial workspace accounts created.");
  }, { timeout: 30000 });
  if (demo) {
    const batch = await seedHistoricalData(db);
    console.info("Historical batch ready (existing records preserved):", JSON.stringify(batch));
  } else {
    console.info("Sample data disabled; existing workspace preserved.");
  }
} finally {
  await db.$disconnect();
}
