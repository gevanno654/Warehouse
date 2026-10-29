import { z } from "zod";

/**
 * Environment variable validation.
 *
 * Validation is split from process access so tests can exercise the rules
 * without mutating `process.env`.
 *
 * Phase 1 consumes `NODE_ENV`, `PORT`, `DATABASE_URL` and `CORS_ORIGIN`.
 * Variables belonging to later phases (`JWT_SECRET`, `BCRYPT_ROUNDS`,
 * `SEED_PASSWORD`, `TEST_DATABASE_URL`, `DATABASE_URL_HOST`) are declared and
 * validated when present, but are not yet mandatory because nothing in this
 * phase reads them. They become required in the phase that uses them.
 */

const nodeEnvSchema = z.enum(["development", "test", "production"]);

const portSchema = z.coerce
  .number({ error: "PORT must be a number" })
  .int("PORT must be an integer")
  .min(1, "PORT must be between 1 and 65535")
  .max(65535, "PORT must be between 1 and 65535");

const connectionStringSchema = (name: string) =>
  z
    .string({ error: `${name} is required` })
    .min(1, `${name} is required`)
    .refine(
      (value) => value.startsWith("postgresql://") || value.startsWith("postgres://"),
      `${name} must be a PostgreSQL connection string`,
    );

/**
 * Validates an absolute browser origin.
 *
 * `URL.canParse` alone is not enough: `localhost:5173` parses as a URL with
 * the scheme `localhost`, so the protocol has to be checked explicitly.
 */
function isAbsoluteHttpOrigin(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  return (
    (parsed.protocol === "http:" || parsed.protocol === "https:") &&
    parsed.origin === value.replace(/\/$/, "")
  );
}

const optionalConnectionStringSchema = (name: string) =>
  connectionStringSchema(name).optional();

export const envSchema = z.object({
  NODE_ENV: nodeEnvSchema.default("development"),
  PORT: portSchema.default(3000),

  DATABASE_URL: connectionStringSchema("DATABASE_URL"),
  DATABASE_URL_HOST: optionalConnectionStringSchema("DATABASE_URL_HOST"),
  TEST_DATABASE_URL: optionalConnectionStringSchema("TEST_DATABASE_URL"),

  // Required by the API contract for browser requests from the `web` service.
  CORS_ORIGIN: z
    .string({ error: "CORS_ORIGIN is required" })
    .min(1, "CORS_ORIGIN is required")
    .refine(
      isAbsoluteHttpOrigin,
      "CORS_ORIGIN must be an absolute origin, for example http://localhost:5173",
    ),

  // Reserved for the authentication phase.
  JWT_SECRET: z
    .string()
    .min(16, "JWT_SECRET must be at least 16 characters")
    .optional(),
  JWT_EXPIRES_IN: z.string().min(1).optional(),

  // Reserved for the authentication phase. Minimum work factor is 10.
  BCRYPT_ROUNDS: z.coerce
    .number({ error: "BCRYPT_ROUNDS must be a number" })
    .int("BCRYPT_ROUNDS must be an integer")
    .min(10, "BCRYPT_ROUNDS minimum is 10")
    .max(15, "BCRYPT_ROUNDS maximum is 15")
    .optional(),

  // Reserved for the development-only seed script.
  SEED_PASSWORD: z.string().min(8).optional(),
});

export type Env = z.infer<typeof envSchema>;

export class ConfigurationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid environment configuration:\n${issues.map((issue) => `  - ${issue}`).join("\n")}`);
    this.name = "ConfigurationError";
    this.issues = issues;
  }
}

/**
 * Validates an environment record and returns the typed result.
 *
 * @throws {ConfigurationError} when any variable is missing or invalid.
 */
export function parseEnv(source: NodeJS.ProcessEnv): Env {
  // Treat blank strings as absent so an empty `PORT=` does not bypass defaults
  // or silently produce an empty required value.
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "string" && value.trim() !== "") {
      normalized[key] = value.trim();
    }
  }

  const result = envSchema.safeParse(normalized);
  if (result.success) {
    return result.data;
  }

  const issues = result.error.issues.map((issue) => {
    const path = issue.path.join(".");
    return path === "" ? issue.message : `${path}: ${issue.message}`;
  });

  throw new ConfigurationError(issues);
}
