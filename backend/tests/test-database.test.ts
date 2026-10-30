import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  assertSafeTestDatabase,
  resolveTestDatabaseUrl,
  TestDatabaseConfigError,
} from "../src/test-support/test-database.js";
import { disconnectTestDatabase, getTestPrisma, resetDatabase } from "./helpers/db.js";

describe("test database configuration safety", () => {
  it("rejects a missing TEST_DATABASE_URL instead of falling back to DATABASE_URL", () => {
    expect(() =>
      resolveTestDatabaseUrl({
        DATABASE_URL: "postgresql://app:app_password@localhost:5432/warehouse",
      }),
    ).toThrow(TestDatabaseConfigError);
  });

  it("names the required variable and forbids a fallback in the message", () => {
    try {
      resolveTestDatabaseUrl({});
      expect.unreachable("expected a TestDatabaseConfigError");
    } catch (error) {
      expect((error as Error).message).toContain("TEST_DATABASE_URL");
      expect((error as Error).message).toContain("never fall back to DATABASE_URL");
    }
  });

  it("rejects a database whose name does not end in _test", () => {
    expect(() =>
      resolveTestDatabaseUrl({
        TEST_DATABASE_URL: "postgresql://app:app_password@localhost:5432/warehouse",
      }),
    ).toThrow(/must end in `_test`/);
  });

  it("rejects a production-looking database name", () => {
    expect(() =>
      resolveTestDatabaseUrl({
        TEST_DATABASE_URL: "postgresql://app:app_password@db:5432/warehouse_production",
      }),
    ).toThrow(TestDatabaseConfigError);
  });

  it("rejects a system database", () => {
    expect(() =>
      resolveTestDatabaseUrl({ TEST_DATABASE_URL: "postgresql://app:pw@localhost:5432/postgres" }),
    ).toThrow(/system database/);
  });

  it("rejects an unparseable connection string", () => {
    expect(() =>
      resolveTestDatabaseUrl({ TEST_DATABASE_URL: "not-a-url" }),
    ).toThrow(/not a valid connection string/);
  });

  it("rejects a connection string without a database name", () => {
    expect(() =>
      resolveTestDatabaseUrl({ TEST_DATABASE_URL: "postgresql://app:pw@localhost:5432" }),
    ).toThrow(/explicit database name/);
  });

  it("rejects TEST_DATABASE_URL identical to DATABASE_URL", () => {
    const url = "postgresql://app:app_password@localhost:5432/warehouse_test";

    expect(() =>
      resolveTestDatabaseUrl({ TEST_DATABASE_URL: url, DATABASE_URL: url }),
    ).toThrow(/must not equal DATABASE_URL/);
  });

  it("accepts an identifiable test database", () => {
    const result = resolveTestDatabaseUrl({
      TEST_DATABASE_URL: "postgresql://app:app_password@localhost:5432/warehouse_test",
    });

    expect(result.databaseName).toBe("warehouse_test");
  });
});

/**
 * The destructive guard is exercised directly, not only through the happy path
 * of `resetDatabase`. These cases run without a database because every one of
 * them is expected to be rejected before a connection is attempted.
 */
describe("destructive operation guard", () => {
  it("accepts a configuration produced by resolveTestDatabaseUrl", () => {
    const config = resolveTestDatabaseUrl({
      TEST_DATABASE_URL: "postgresql://app:app_password@localhost:5432/warehouse_test",
    });

    expect(() => assertSafeTestDatabase(config)).not.toThrow();
  });

  it("rejects a database name that does not end in _test", () => {
    expect(() =>
      assertSafeTestDatabase({
        url: "postgresql://app:app_password@localhost:5432/warehouse",
        databaseName: "warehouse",
      }),
    ).toThrow(/Refusing a destructive database operation against "warehouse"/);
  });

  it("rejects a production database name", () => {
    expect(() =>
      assertSafeTestDatabase({
        url: "postgresql://app:app_password@db:5432/warehouse_production",
        databaseName: "warehouse_production",
      }),
    ).toThrow(TestDatabaseConfigError);
  });

  it("rejects the postgres system database", () => {
    expect(() =>
      assertSafeTestDatabase({
        url: "postgresql://app:app_password@localhost:5432/postgres",
        databaseName: "postgres",
      }),
    ).toThrow(/system database/);
  });

  it("rejects a configuration whose label disagrees with its connection string", () => {
    // A hand-built config could otherwise pair a production URL with a `_test`
    // label and pass a name-only check.
    expect(() =>
      assertSafeTestDatabase({
        url: "postgresql://app:app_password@db:5432/warehouse",
        databaseName: "warehouse_test",
      }),
    ).toThrow(/does not match the connection string target/);
  });

  it("rejects an empty connection string", () => {
    expect(() =>
      assertSafeTestDatabase({ url: "", databaseName: "warehouse_test" }),
    ).toThrow(/no connection string/);
  });
});

describe("test database runtime behaviour", () => {
  afterAll(async () => {
    await disconnectTestDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  it("truncates application tables between tests", async () => {
    const prisma = getTestPrisma();
    await prisma.user.create({
      data: {
        email: "reset-check@example.com",
        passwordHash: "x",
        role: "OPERATOR",
      },
    });

    await resetDatabase();

    await expect(prisma.user.count()).resolves.toBe(0);
  });
});
