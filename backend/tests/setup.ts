/**
 * Global test setup.
 *
 * The suite is split in two:
 * - Unit tests (health, config, error handling, test-database rules) run with
 *   no database at all. That is a supported mode and the default.
 * - Integration tests (schema, seed) additionally require a reachable
 *   `TEST_DATABASE_URL` naming a `_test` database. They fail with the
 *   documented message when it is absent instead of falling back.
 *
 * Set `TEST_DATABASE_URL` to run the integration tests.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { config as loadDotenvConfig } from "dotenv";

const repositoryRoot = resolve(import.meta.dirname, "..", "..");
const rootEnv = resolve(repositoryRoot, ".env");
const backendEnv = resolve(import.meta.dirname, "..", ".env");

if (existsSync(rootEnv)) {
  loadDotenvConfig({ path: rootEnv, quiet: true });
}
if (existsSync(backendEnv)) {
  loadDotenvConfig({ path: backendEnv, quiet: true, override: false });
}

// Tests never open the development database. `DATABASE_URL` is removed so an
// accidental fallback in test code would fail loudly rather than connect to a
// real database.
delete process.env["DATABASE_URL"];
