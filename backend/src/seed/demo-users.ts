/**
 * Development seed logic.
 *
 * Kept separate from `prisma/seed.ts` so the behaviour can be tested without
 * spawning a process or intercepting `process.exit`.
 *
 * Rules from `docs/technical-spec.md` §9.4 and `AGENTS.md` §7:
 * - Idempotent: upsert by email; a second run creates no duplicates.
 * - The password comes from `SEED_PASSWORD`; nothing is hard-coded.
 * - Demo users are refused in production unless `ALLOW_PROD_SEED=true`.
 * - bcrypt work factor 12 by default, minimum 10.
 * - Re-running does not silently reset an existing password.
 */
import type { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

export interface SeedAccount {
  readonly email: string;
  readonly role: "OPERATOR" | "SUPERVISOR";
}

/** The two approved demo accounts. */
export const SEED_ACCOUNTS: readonly SeedAccount[] = [
  { email: "supervisor@example.com", role: "SUPERVISOR" },
  { email: "operator@example.com", role: "OPERATOR" },
];

export const DEFAULT_BCRYPT_ROUNDS = 12;
export const MINIMUM_BCRYPT_ROUNDS = 10;

export type SeedOutcome =
  | { readonly status: "created"; readonly email: string }
  | { readonly status: "role-updated"; readonly email: string }
  | { readonly status: "unchanged"; readonly email: string };

export class SeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeedError";
  }
}

export interface SeedOptions {
  readonly nodeEnv: string;
  readonly allowProdSeed: string | undefined;
  readonly seedPassword: string | undefined;
  readonly bcryptRounds: string | undefined;
}

export interface ResolvedSeedConfig {
  readonly password: string;
  readonly rounds: number;
}

/**
 * Validates the environment for a seed run.
 *
 * @throws {SeedError} for a production attempt without the explicit override,
 *         or when the password is missing.
 */
export function resolveSeedConfig(options: SeedOptions): ResolvedSeedConfig {
  if (options.nodeEnv === "production" && options.allowProdSeed !== "true") {
    throw new SeedError(
      "refusing to run in production. Demo accounts are development-only. " +
        "Set ALLOW_PROD_SEED=true only if you deliberately intend to create them.",
    );
  }

  const password = options.seedPassword;
  if (password === undefined || password.trim() === "") {
    throw new SeedError(
      "SEED_PASSWORD is not set. Copy .env.example to .env and set a development password.",
    );
  }

  let rounds = DEFAULT_BCRYPT_ROUNDS;
  const rawRounds = options.bcryptRounds;
  if (rawRounds !== undefined && rawRounds.trim() !== "") {
    const parsed = Number(rawRounds);
    if (!Number.isInteger(parsed) || parsed < MINIMUM_BCRYPT_ROUNDS) {
      throw new SeedError(
        `BCRYPT_ROUNDS must be an integer of at least ${MINIMUM_BCRYPT_ROUNDS}.`,
      );
    }
    rounds = parsed;
  }

  return { password, rounds };
}

/**
 * Seeds the demo accounts into the given client.
 *
 * Returns one outcome per account so callers and tests can assert idempotency.
 */
export async function seedDemoAccounts(
  prisma: PrismaClient,
  config: ResolvedSeedConfig,
): Promise<SeedOutcome[]> {
  const results: SeedOutcome[] = [];

  for (const account of SEED_ACCOUNTS) {
    const existing = await prisma.user.findUnique({ where: { email: account.email } });

    if (existing === null) {
      const passwordHash = await bcrypt.hash(config.password, config.rounds);
      await prisma.user.create({
        data: { email: account.email, passwordHash, role: account.role },
      });
      results.push({ status: "created", email: account.email });
      continue;
    }

    if (existing.role !== account.role) {
      // Keep the documented role authoritative without touching the password.
      await prisma.user.update({
        where: { email: account.email },
        data: { role: account.role },
      });
      results.push({ status: "role-updated", email: account.email });
      continue;
    }

    results.push({ status: "unchanged", email: account.email });
  }

  return results;
}
