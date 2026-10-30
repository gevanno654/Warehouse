/**
 * Test-database safety.
 *
 * Automated tests must never run against the development or production
 * database. Two independent safeguards are applied, per
 * `docs/technical-spec.md` §9.6 and `AGENTS.md` §8:
 *
 * 1. `TEST_DATABASE_URL` must be set. There is no fallback to `DATABASE_URL`.
 * 2. The resolved database name must be explicitly identifiable as a test
 *    database, so pointing `TEST_DATABASE_URL` at `warehouse` or a production
 *    database fails before any connection or destructive statement runs.
 *
 * Destructive helpers refuse to run unless both checks pass.
 */

/** A database name is a test database only if it matches this rule. */
export const TEST_DATABASE_NAME_PATTERN = /_test$/;

/**
 * Database names that are never acceptable targets, even if they end in
 * `_test`, because they are commonly used for real deployments.
 */
const PROTECTED_DATABASE_NAMES = new Set(["postgres", "template0", "template1"]);

export class TestDatabaseConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TestDatabaseConfigError";
  }
}

function parseDatabaseName(connectionString: string): string {
  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new TestDatabaseConfigError(
      "TEST_DATABASE_URL is not a valid connection string.",
    );
  }

  // `new URL("postgresql://u:p@host:5432/db")` exposes the database name as
  // the pathname without the leading slash.
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ""));

  if (name === "") {
    throw new TestDatabaseConfigError(
      "TEST_DATABASE_URL must include an explicit database name, for example .../warehouse_test",
    );
  }

  return name;
}

export interface TestDatabaseConfig {
  /** Connection string used by the test suite. */
  readonly url: string;
  /** Resolved database name, used for the safety rule. */
  readonly databaseName: string;
}

/**
 * Resolves and validates the test database configuration.
 *
 * @throws {TestDatabaseConfigError} when the variable is missing, malformed, or
 *         does not name an identifiable test database.
 */
export function resolveTestDatabaseUrl(source: NodeJS.ProcessEnv = process.env): TestDatabaseConfig {
  const url = source["TEST_DATABASE_URL"]?.trim();

  if (url === undefined || url === "") {
    throw new TestDatabaseConfigError(
      "TEST_DATABASE_URL is not set. Automated tests require a dedicated test " +
        "database and never fall back to DATABASE_URL. Set it to a database " +
        "whose name ends in `_test`, for example " +
        "postgresql://user:password@localhost:5432/warehouse_test",
    );
  }

  const databaseName = parseDatabaseName(url);

  if (PROTECTED_DATABASE_NAMES.has(databaseName)) {
    throw new TestDatabaseConfigError(
      `Refusing to use the system database "${databaseName}" for tests.`,
    );
  }

  if (!TEST_DATABASE_NAME_PATTERN.test(databaseName)) {
    throw new TestDatabaseConfigError(
      `Refusing to use database "${databaseName}" for tests: the name must end ` +
        "in `_test` so a test database is unambiguous. Tests never run against " +
        "a development or production database.",
    );
  }

  const developmentUrl = source["DATABASE_URL"]?.trim();
  if (developmentUrl !== undefined && developmentUrl !== "" && developmentUrl === url) {
    throw new TestDatabaseConfigError(
      "TEST_DATABASE_URL must not equal DATABASE_URL. Tests require a separate database.",
    );
  }

  return { url, databaseName };
}

/**
 * Guard for any destructive statement.
 *
 * This is not a formality around `resolveTestDatabaseUrl`. A `DatabaseConfig`
 * can be constructed by hand, so the name is re-derived from `config.url` here
 * and must agree with `config.databaseName`. Without that re-derivation a
 * caller could pair a production URL with a `_test` label and pass the check
 * while pointing at a real database.
 *
 * A name ending in `_test` is necessary but not sufficient: the system
 * databases are rejected outright, exactly as in `resolveTestDatabaseUrl`.
 *
 * @throws {TestDatabaseConfigError} when the target cannot be proven to be a
 *         test database.
 */
export function assertSafeTestDatabase(config: TestDatabaseConfig): void {
  if (config.url.trim() === "") {
    throw new TestDatabaseConfigError(
      "Refusing a destructive database operation: no connection string was provided.",
    );
  }

  // Re-derive the name from the URL. A mismatch means the config was not
  // produced by `resolveTestDatabaseUrl` and cannot be trusted.
  const resolvedName = parseDatabaseName(config.url);
  if (resolvedName !== config.databaseName) {
    throw new TestDatabaseConfigError(
      `Refusing a destructive database operation: the configured database name ` +
        `"${config.databaseName}" does not match the connection string target ` +
        `"${resolvedName}".`,
    );
  }

  if (PROTECTED_DATABASE_NAMES.has(resolvedName)) {
    throw new TestDatabaseConfigError(
      `Refusing a destructive database operation against the system database "${resolvedName}".`,
    );
  }

  if (!TEST_DATABASE_NAME_PATTERN.test(resolvedName)) {
    throw new TestDatabaseConfigError(
      `Refusing a destructive database operation against "${resolvedName}".`,
    );
  }
}

/**
 * Dependency-ordered table list from `docs/technical-spec.md` §9.6.
 *
 * `TRUNCATE ... CASCADE` removes dependants automatically, but the order is
 * kept explicit so the intent matches the specification.
 */
export const APPLICATION_TABLES = [
  "inventory_transactions",
  "receipt_operations",
  "receiving_items",
  "receiving_documents",
  "inventories",
  "products",
  "users",
] as const;
