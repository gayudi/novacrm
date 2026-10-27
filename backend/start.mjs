import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

process.env.AZURE_OPENAI_ENV_FILE ??= fileURLToPath(new URL("../.env", import.meta.url));

if (!process.env.DATABASE_URL) {
  const { DB_USER, DB_PASSWORD, DB_HOST, DB_NAME } = process.env;
  if (!DB_USER || !DB_PASSWORD || !DB_HOST || !DB_NAME) {
    throw new Error("DATABASE_URL or all DB_* connection settings are required.");
  }
  process.env.DATABASE_URL = `postgresql://${encodeURIComponent(DB_USER)}:${encodeURIComponent(DB_PASSWORD)}@${DB_HOST}:5432/${encodeURIComponent(DB_NAME)}?schema=public`;
}

for (const args of [
  ["node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", "backend/prisma/schema.prisma"],
  ["backend/dist/prisma/seed.js"],
]) {
  const result = spawnSync(process.execPath, args, { stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
await import("./dist/src/server.js");
