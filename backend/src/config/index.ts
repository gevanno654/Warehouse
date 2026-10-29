import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { config as loadDotenvConfig } from "dotenv";

import { parseEnv, type Env } from "./env.js";

export interface AppConfig {
  readonly nodeEnv: Env["NODE_ENV"];
  readonly isProduction: boolean;
  readonly port: number;
  readonly databaseUrl: string;
  readonly corsOrigin: string;
  /** Absolute path to the approved OpenAPI document served by Swagger UI. */
  readonly openApiDocumentPath: string;
}

/**
 * `src/config` and `dist/config` are both two levels below the backend root,
 * and three levels below the repository root, so one expression is correct in
 * development and in the built image.
 */
const backendRoot = resolve(import.meta.dirname, "..", "..");
const repositoryRoot = resolve(backendRoot, "..");

/**
 * Locates the approved OpenAPI document.
 *
 * In a repository checkout it lives at `<repo>/docs/openapi.yaml`. The Docker
 * image copies the same file to `/app/docs/openapi.yaml`, so both layouts are
 * checked and the document is never duplicated in source.
 */
function resolveOpenApiDocumentPath(): string {
  const candidates = [
    resolve(repositoryRoot, "docs", "openapi.yaml"),
    resolve(backendRoot, "docs", "openapi.yaml"),
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
}

/**
 * Loads `.env` files and returns the validated application configuration.
 *
 * The repository-root `.env` is the documented location. The local
 * `backend/.env` is also read so a developer can override a single value
 * without editing the shared file. Real `.env` files are never committed.
 *
 * @throws {ConfigurationError} when required configuration is missing or invalid.
 */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  loadDotenvConfig({ path: resolve(repositoryRoot, ".env"), quiet: true });
  loadDotenvConfig({ path: resolve(backendRoot, ".env"), quiet: true, override: false });

  const env = parseEnv(source);

  return {
    nodeEnv: env.NODE_ENV,
    isProduction: env.NODE_ENV === "production",
    port: env.PORT,
    databaseUrl: env.DATABASE_URL,
    corsOrigin: env.CORS_ORIGIN,
    openApiDocumentPath: resolveOpenApiDocumentPath(),
  };
}
