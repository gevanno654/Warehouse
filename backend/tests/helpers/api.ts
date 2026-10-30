/**
 * HTTP test helpers.
 *
 * Builds the real Express application around the real Prisma client bound to
 * the isolated test database, so the auth and product suites exercise routing,
 * middleware, validation, and persistence together rather than a mock.
 *
 * The bcrypt cost here is deliberately low: the hash is only ever compared by
 * these tests, and `bcrypt.compare` reads the cost from the stored hash, so a
 * cheap hash keeps the suite fast without weakening the production work factor
 * that `resolveSeedConfig` and `parseEnv` enforce.
 */
import { resolve } from "node:path";

import request from "supertest";
import bcrypt from "bcrypt";

import type { PrismaClient, UserRole } from "@prisma/client";
import type { Express } from "express";

import { createApp } from "../../src/app.js";
import type { AppConfig } from "../../src/config/index.js";
import { createTokenService } from "../../src/lib/tokens.js";

export const TEST_JWT_SECRET = "test-only-signing-secret-value";
export const TEST_JWT_EXPIRES_IN_SECONDS = 3600;

/** Cheap on purpose; see the file comment. */
const TEST_BCRYPT_ROUNDS = 4;

export const TEST_PASSWORD = "correct-horse-battery";

const openApiDocumentPath = resolve(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "docs",
  "openapi.yaml",
);

export function buildTestConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    nodeEnv: "test",
    isProduction: false,
    port: 3000,
    databaseUrl: "postgresql://unused@127.0.0.1:1/unused",
    corsOrigin: "http://localhost:5173",
    openApiDocumentPath,
    jwtSecret: TEST_JWT_SECRET,
    jwtExpiresInSeconds: TEST_JWT_EXPIRES_IN_SECONDS,
    ...overrides,
  };
}

export function createTestApp(
  prisma: PrismaClient,
  overrides: Partial<AppConfig> = {},
): Express {
  return createApp({
    config: buildTestConfig(overrides),
    checkDatabase: () => Promise.resolve(true),
    prisma,
  });
}

export interface SignedTokenOptions {
  readonly secret?: string;
  readonly expiresInSeconds?: number;
}

/**
 * Signs a token through the production `TokenService` so the suite never
 * hand-rolls a JWT. `expiresInSeconds: 0` produces a token whose `exp` equals
 * its `iat`, which verification rejects.
 */
export function signToken(
  claims: { readonly userId: string; readonly role: UserRole },
  options: SignedTokenOptions = {},
): Promise<string> {
  const tokens = createTokenService({
    secret: options.secret ?? TEST_JWT_SECRET,
    expiresInSeconds: options.expiresInSeconds ?? TEST_JWT_EXPIRES_IN_SECONDS,
  });

  return tokens.issue(claims).then((issued) => issued.token);
}

export interface CreateUserInput {
  readonly email: string;
  readonly role: UserRole;
  readonly password?: string;
}

export interface SeededUser {
  readonly id: string;
  readonly email: string;
  readonly role: UserRole;
}

/** Inserts a user with a real bcrypt hash, as login expects. */
export async function createUser(
  prisma: PrismaClient,
  input: CreateUserInput,
): Promise<SeededUser> {
  const passwordHash = await bcrypt.hash(input.password ?? TEST_PASSWORD, TEST_BCRYPT_ROUNDS);

  const user = await prisma.user.create({
    data: {
      email: input.email,
      passwordHash,
      role: input.role,
    },
  });

  return { id: user.id, email: user.email, role: user.role };
}

/** Creates a user and returns a valid bearer token for it. */
export async function createUserWithToken(
  prisma: PrismaClient,
  input: CreateUserInput,
): Promise<SeededUser & { readonly token: string }> {
  const user = await createUser(prisma, input);

  const token = await signToken({ userId: user.id, role: user.role });

  return { ...user, token };
}

/** `Authorization: Bearer <token>` helper. */
export function bearer(token: string): string {
  return `Bearer ${token}`;
}

/** Runs a request against a fresh app bound to `prisma`. */
export function api(prisma: PrismaClient, overrides: Partial<AppConfig> = {}) {
  return request(createTestApp(prisma, overrides));
}
