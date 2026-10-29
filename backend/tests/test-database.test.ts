import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
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
