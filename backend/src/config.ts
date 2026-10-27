import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";

const env = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  JWT_SECRET: z.string().optional(),
  JWT_SECRET_FILE: z.string().default(resolve(".runtime", "jwt-secret")),
  ENABLE_DEMO_DATA: z.enum(["true", "false"]).default("false"),
  ADMIN_EMAIL: z.string().email().default("admin@nova.example"),
}).parse(process.env);

function signingSecret(): string {
  if (env.JWT_SECRET) {
    if (env.JWT_SECRET.length < 32) throw new Error("JWT_SECRET must contain at least 32 characters.");
    return env.JWT_SECRET;
  }
  mkdirSync(dirname(env.JWT_SECRET_FILE), { recursive: true });
  try {
    writeFileSync(env.JWT_SECRET_FILE, randomBytes(48).toString("hex"), { flag: "wx", mode: 0o600 });
    console.info("Generated a persistent JWT signing secret.");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
  }
  const secret = readFileSync(env.JWT_SECRET_FILE, "utf8").trim();
  if (secret.length < 32) throw new Error("Stored JWT signing secret is invalid.");
  return secret;
}

export const config = { ...env, jwtSecret: signingSecret() };
