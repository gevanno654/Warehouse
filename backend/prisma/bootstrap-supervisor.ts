/**
 * Secure interactive supervisor bootstrap CLI.
 *
 * Run only on the server after a successful production migration:
 *   NODE_ENV=production npm run db:bootstrap-supervisor
 *
 * - Email is read from a visible prompt.
 * - Password + confirmation are read from hidden prompts (no echo).
 * - Password is never read from CLI args, files, or persistent env vars,
 *   never printed, and lives only in process memory.
 * - Refuses unless NODE_ENV=production and unless the database has no
 *   SUPERVISOR yet. All database work runs in one advisory-locked transaction
 *   (see `src/seed/bootstrap-supervisor.ts`).
 */
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { stdin as input, stdout as output } from "node:process";

import { config as loadDotenvConfig } from "dotenv";
import type { PrismaClient } from "@prisma/client";

import { createPrismaClient } from "../src/lib/database.js";
import {
  BootstrapError,
  bootstrapSupervisor,
  resolveBootstrapInput,
} from "../src/seed/bootstrap-supervisor.js";

// Load DATABASE_URL (and BCRYPT_ROUNDS) from the repo-root .env.production
// when not already exported. The bootstrap *password* is never read from any
// file or environment variable — it only comes from the hidden prompt below.
const repositoryRoot = resolve(import.meta.dirname, "..", "..");
if (!process.env["DATABASE_URL"]) {
  const prodEnv = resolve(repositoryRoot, ".env.production");
  if (existsSync(prodEnv)) {
    loadDotenvConfig({ path: prodEnv, quiet: true });
  }
}

/**
 * On the host, the Compose hostname `db` does not resolve (no published
 * ports by design). The bridge container IP is reachable from the host, so
 * transparently rewrite `@db:`/`@db/` to the live container IP. Inside a
 * container on the production network `db` already resolves and is kept.
 */
function resolveDatabaseUrlForHost(raw: string): string {
  let host: string | undefined;
  try {
    host = new URL(raw).hostname;
  } catch {
    return raw;
  }
  if (host !== "db") {
    return raw;
  }
  try {
    const ip = execSync(
      "docker inspect warehouse-db-production --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'",
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
      return raw.replace("@db:", `@${ip}:`).replace("@db/", `@${ip}/`);
    }
  } catch {
    // Fall through with the original URL; Prisma will surface a clear error.
  }
  return raw;
}

function promptVisible(question: string): Promise<string> {
  const rl = createInterface({ input, output });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/**
 * Reads one line without echoing input.
 * Falls back to visible input when stdin is not a TTY (e.g. piped tests),
 * because hidden entry requires raw-mode control of the terminal.
 */
function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    if (!input.isTTY || typeof input.setRawMode !== "function") {
      void promptVisible(question).then(resolve);
      return;
    }

    output.write(question);
    let buffer = "";
    const onData = (chunk: Buffer): void => {
      const text = chunk.toString("utf8");
      for (const char of text) {
        if (char === "\n" || char === "\r" || char === "\u0004") {
          input.setRawMode(false);
          input.removeListener("data", onData);
          output.write("\n");
          resolve(buffer);
          return;
        }
        if (char === "\u0003") {
          // Ctrl+C: restore the terminal before exiting.
          input.setRawMode(true);
          output.write("\n");
          process.exit(130);
        }
        if (char === "\u007f" || char === "\b") {
          buffer = buffer.slice(0, -1);
          continue;
        }
        buffer += char;
      }
    };

    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
  });
}

async function main(): Promise<void> {
  const nodeEnv = process.env["NODE_ENV"] ?? "development";
  const databaseUrl = resolveDatabaseUrlForHost(process.env["DATABASE_URL"] ?? "");
  if (databaseUrl.trim() === "") {
    console.error("[bootstrap] DATABASE_URL is not set.");
    process.exit(1);
  }

  const email = await promptVisible("Supervisor email: ");
  const password = await promptHidden("Supervisor password (hidden, min 12 chars): ");
  const confirmPassword = await promptHidden("Confirm password (hidden): ");

  let config;
  try {
    config = resolveBootstrapInput({
      nodeEnv,
      email,
      password,
      confirmPassword,
      bcryptRounds: process.env["BCRYPT_ROUNDS"],
    });
  } catch (error) {
    if (error instanceof BootstrapError) {
      console.error(`[bootstrap] ${error.message}`);
      process.exit(1);
    }
    throw error;
  }

  const prisma: PrismaClient = createPrismaClient(databaseUrl);
  try {
    const result = await bootstrapSupervisor(prisma, config);
    console.log(`[bootstrap] supervisor ${result.email} created.`);
  } catch (error) {
    if (error instanceof BootstrapError) {
      console.error(`[bootstrap] ${error.message}`);
      process.exit(1);
    }
    console.error("[bootstrap] failed: unexpected error.");
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(() => {
  console.error("[bootstrap] failed: unexpected error.");
  process.exit(1);
});
