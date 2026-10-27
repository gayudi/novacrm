import { readFile } from "node:fs/promises";
import type { PrismaClient } from "@prisma/client";

export async function seedHistoricalData(db: PrismaClient, asOf?: Date) {
  const sql = await readFile(new URL("./historical-seed.sql", import.meta.url), "utf8");
  await db.$transaction(async tx => {
    if (asOf) await tx.$queryRaw`SELECT set_config('nova.seed_as_of', ${asOf.toISOString()}, true)`;
    // This is a trusted, versioned SQL file, never user-supplied SQL.
    await tx.$executeRawUnsafe(sql);
  }, { timeout: 120000, maxWait: 15000 });
  return db.seedBatch.findUniqueOrThrow({ where: { id: "retail-history-v1" } });
}
