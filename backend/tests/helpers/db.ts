import { PrismaClient } from "@prisma/client";

import {
  APPLICATION_TABLES,
  assertSafeTestDatabase,
  resolveTestDatabaseUrl,
  type TestDatabaseConfig,
} from "../../src/test-support/test-database.js";

let client: PrismaClient | undefined;
let config: TestDatabaseConfig | undefined;

/**
 * Returns a Prisma client bound to the validated test database.
 *
 * Resolution happens lazily so a missing or unsafe `TEST_DATABASE_URL` fails
 * with the documented message rather than a generic connection error.
 */
export function getTestPrisma(): PrismaClient {
  if (client === undefined) {
    config = resolveTestDatabaseUrl();
    client = new PrismaClient({ datasourceUrl: config.url });
  }
  return client;
}

/**
 * Truncates every application table.
 *
 * `RESTART IDENTITY CASCADE` is used because the test database retains no
 * data; the target has already been proven to be a test database.
 */
export async function resetDatabase(): Promise<void> {
  if (config === undefined) {
    config = resolveTestDatabaseUrl();
  }
  assertSafeTestDatabase(config);

  const tableList = APPLICATION_TABLES.map((table) => `"${table}"`).join(", ");
  await getTestPrisma().$executeRawUnsafe(
    `TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`,
  );
}

export async function disconnectTestDatabase(): Promise<void> {
  if (client !== undefined) {
    await client.$disconnect();
    client = undefined;
  }
}
