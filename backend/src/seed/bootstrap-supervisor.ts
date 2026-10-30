/**
 * One-time production supervisor bootstrap.
 *
 * Creates exactly one SUPERVISOR account and refuses to run again once any
 * SUPERVISOR exists. CLI-only: there is no HTTP endpoint for user creation.
 *
 * Security properties:
 * - Email is read from an interactive visible prompt.
 * - Password + confirmation are read from hidden prompts (no echo), never
 *   from CLI args, files, or persistent environment variables.
 * - Nothing secret is printed to stdout/stderr/logs.
 * - Password lives only in process memory for the duration of the run.
 * - Hashing uses bcrypt with the same policy as the login path
 *   (`bcrypt.compare` in `modules/auth/service.ts`): default 12, range 10-15.
 * - Refuses when NODE_ENV !== "production".
 * - All database work happens inside one Prisma transaction guarded by a
 *   PostgreSQL transaction-level advisory lock, so two concurrent runs
 *   serialize and produce exactly one SUPERVISOR.
 * - `users.email` unique constraint is the final guard; violations are
 *   mapped to a safe BootstrapError without leaking database internals.
 */
import type { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 255;
const MIN_PASSWORD_LENGTH = 12;
export const DEFAULT_BCRYPT_ROUNDS = 12;
export const MINIMUM_BCRYPT_ROUNDS = 10;
export const MAXIMUM_BCRYPT_ROUNDS = 15;

/**
 * Fixed advisory-lock key for supervisor bootstrap.
 * Any 64-bit bigint works; this one is arbitrary and documented so every
 * concurrent bootstrap contends on the same lock.
 */
export const BOOTSTRAP_ADVISORY_LOCK_KEY = "8417964523109753";

export class BootstrapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BootstrapError";
  }
}

export interface BootstrapInput {
  readonly nodeEnv: string;
  readonly email: string;
  readonly password: string;
  readonly confirmPassword: string;
  readonly bcryptRounds: string | undefined;
}

export interface ResolvedBootstrapConfig {
  readonly email: string;
  readonly password: string;
  readonly rounds: number;
}

/**
 * Validates interactive input before touching the database.
 *
 * @throws {BootstrapError} for a non-production env, bad email, short or
 *         mismatched password, or an out-of-range bcrypt work factor.
 */
export function resolveBootstrapInput(input: BootstrapInput): ResolvedBootstrapConfig {
  if (input.nodeEnv.trim() !== "production") {
    throw new BootstrapError("refusing to run outside NODE_ENV=production.");
  }

  const email = input.email.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email) || email.length > MAX_EMAIL_LENGTH) {
    throw new BootstrapError("email must be a valid address of at most 255 characters.");
  }

  if (input.password.length < MIN_PASSWORD_LENGTH) {
    throw new BootstrapError(
      `password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    );
  }

  if (input.password !== input.confirmPassword) {
    throw new BootstrapError("password and confirmation do not match.");
  }

  let rounds = DEFAULT_BCRYPT_ROUNDS;
  const rawRounds = (input.bcryptRounds ?? "").trim();
  if (rawRounds !== "") {
    const parsed = Number(rawRounds);
    if (
      !Number.isInteger(parsed) ||
      parsed < MINIMUM_BCRYPT_ROUNDS ||
      parsed > MAXIMUM_BCRYPT_ROUNDS
    ) {
      throw new BootstrapError(
        `BCRYPT_ROUNDS must be an integer between ${MINIMUM_BCRYPT_ROUNDS} and ${MAXIMUM_BCRYPT_ROUNDS}.`,
      );
    }
    rounds = parsed;
  }

  return { email, password: input.password, rounds };
}

export interface BootstrapResult {
  readonly email: string;
  readonly created: boolean;
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  return code === "P2002";
}

/**
 * Creates the first SUPERVISOR inside a single transaction.
 *
 * The advisory lock serializes concurrent bootstraps: the second transaction
 * blocks on `pg_advisory_xact_lock` until the first commits or rolls back,
 * then sees the new SUPERVISOR and refuses. The lock is transaction-scoped,
 * so it is always released on commit/rollback.
 *
 * @throws {BootstrapError} when a SUPERVISOR exists, the email is taken, or
 *         a unique violation races in.
 */
export async function bootstrapSupervisor(
  prisma: PrismaClient,
  config: ResolvedBootstrapConfig,
): Promise<BootstrapResult> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `SELECT pg_advisory_xact_lock(${BOOTSTRAP_ADVISORY_LOCK_KEY})`,
    );

    const existingSupervisor = await tx.user.findFirst({
      where: { role: "SUPERVISOR" },
      select: { id: true },
    });

    if (existingSupervisor !== null) {
      throw new BootstrapError("a SUPERVISOR account already exists; refusing to create another.");
    }

    const existingEmail = await tx.user.findUnique({
      where: { email: config.email },
      select: { id: true },
    });

    if (existingEmail !== null) {
      throw new BootstrapError("that email is already registered; choose another address.");
    }

    const passwordHash = await bcrypt.hash(config.password, config.rounds);

    try {
      await tx.user.create({
        data: { email: config.email, passwordHash, role: "SUPERVISOR" },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new BootstrapError("that email is already registered; choose another address.");
      }
      throw error;
    }

    return { email: config.email, created: true };
  });
}
