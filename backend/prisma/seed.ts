/**
 * Seed CLI.
 *
 * Run with `npm run db:seed`. The behaviour lives in `src/seed/demo-users.ts`;
 * this file only wires environment variables and the Prisma client to it.
 */
import { PrismaClient } from "@prisma/client";
import { config as loadDotenvConfig } from "dotenv";
import { resolve } from "node:path";

import { resolveSeedConfig, seedDemoAccounts, SeedError } from "../src/seed/demo-users.js";

const repositoryRoot = resolve(import.meta.dirname, "..", "..");
loadDotenvConfig({ path: resolve(repositoryRoot, ".env"), quiet: true });
loadDotenvConfig({ path: resolve(process.cwd(), ".env"), quiet: true, override: false });

async function main(): Promise<void> {
  let config;
  try {
    config = resolveSeedConfig({
      nodeEnv: process.env["NODE_ENV"] ?? "development",
      allowProdSeed: process.env["ALLOW_PROD_SEED"],
      seedPassword: process.env["SEED_PASSWORD"],
      bcryptRounds: process.env["BCRYPT_ROUNDS"],
    });
  } catch (error) {
    if (error instanceof SeedError) {
      console.error(`[seed] ${error.message}`);
      process.exit(1);
    }
    throw error;
  }

  const databaseUrl = process.env["DATABASE_URL"];
  if (databaseUrl === undefined || databaseUrl.trim() === "") {
    console.error("[seed] DATABASE_URL is not set.");
    process.exit(1);
  }

  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });

  try {
    const outcomes = await seedDemoAccounts(prisma, config);

    for (const outcome of outcomes) {
      const detail =
        outcome.status === "created"
          ? "created"
          : outcome.status === "role-updated"
            ? "role updated"
            : "already exists; left unchanged";
      console.log(`[seed] ${outcome.email}: ${detail}`);
    }

    console.log("[seed] complete");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error("[seed] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
