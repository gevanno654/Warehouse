import bcrypt from "bcrypt";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  SEED_ACCOUNTS,
  SeedError,
  resolveSeedConfig,
  seedDemoAccounts,
} from "../src/seed/demo-users.js";
import { disconnectTestDatabase, getTestPrisma, resetDatabase } from "./helpers/db.js";

const prisma = () => getTestPrisma();

describe("seed configuration", () => {
  it("refuses to run in production without ALLOW_PROD_SEED", () => {
    expect(() =>
      resolveSeedConfig({
        nodeEnv: "production",
        allowProdSeed: undefined,
        seedPassword: "a-development-password",
        bcryptRounds: undefined,
      }),
    ).toThrow(SeedError);
  });

  it("names the production guard in its message", () => {
    try {
      resolveSeedConfig({
        nodeEnv: "production",
        allowProdSeed: undefined,
        seedPassword: "a-development-password",
        bcryptRounds: undefined,
      });
      expect.unreachable("expected a SeedError");
    } catch (error) {
      expect((error as Error).message).toContain("ALLOW_PROD_SEED");
    }
  });

  it("allows production only with the explicit override", () => {
    expect(() =>
      resolveSeedConfig({
        nodeEnv: "production",
        allowProdSeed: "true",
        seedPassword: "a-development-password",
        bcryptRounds: undefined,
      }),
    ).not.toThrow();
  });

  it("requires SEED_PASSWORD outside production too", () => {
    expect(() =>
      resolveSeedConfig({
        nodeEnv: "development",
        allowProdSeed: undefined,
        seedPassword: undefined,
        bcryptRounds: undefined,
      }),
    ).toThrow(/SEED_PASSWORD is not set/);
  });

  it("defaults the bcrypt work factor to 12", () => {
    const config = resolveSeedConfig({
      nodeEnv: "development",
      allowProdSeed: undefined,
      seedPassword: "a-development-password",
      bcryptRounds: undefined,
    });

    expect(config.rounds).toBe(12);
  });

  it("rejects a work factor below the documented minimum", () => {
    expect(() =>
      resolveSeedConfig({
        nodeEnv: "development",
        allowProdSeed: undefined,
        seedPassword: "a-development-password",
        bcryptRounds: "8",
      }),
    ).toThrow(SeedError);
  });
});

describe("seed behaviour against the test database", () => {
  const config = { password: "development-only-password", rounds: 10 };

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await disconnectTestDatabase();
  });

  it("creates exactly the two approved accounts", async () => {
    await seedDemoAccounts(prisma(), config);

    const users = await prisma().user.findMany({ orderBy: { email: "asc" } });

    expect(users).toHaveLength(2);
    expect(users.map((user) => user.email)).toEqual([
      "operator@example.com",
      "supervisor@example.com",
    ]);
    expect(users.map((user) => user.role)).toEqual(["OPERATOR", "SUPERVISOR"]);
  });

  it("hashes passwords with bcrypt and never stores plaintext", async () => {
    await seedDemoAccounts(prisma(), config);

    const users = await prisma().user.findMany();

    for (const user of users) {
      expect(user.passwordHash).not.toBe(config.password);
      expect(user.passwordHash.startsWith("$2")).toBe(true);
      await expect(bcrypt.compare(config.password, user.passwordHash)).resolves.toBe(true);
    }
  });

  it("is idempotent: a second run creates no duplicates", async () => {
    const first = await seedDemoAccounts(prisma(), config);
    const second = await seedDemoAccounts(prisma(), config);

    expect(first.every((outcome) => outcome.status === "created")).toBe(true);
    expect(second.every((outcome) => outcome.status === "unchanged")).toBe(true);

    await expect(prisma().user.count()).resolves.toBe(SEED_ACCOUNTS.length);
  });

  it("does not reset an existing password on re-run", async () => {
    await seedDemoAccounts(prisma(), config);
    const before = await prisma().user.findUniqueOrThrow({
      where: { email: "supervisor@example.com" },
    });

    await seedDemoAccounts(prisma(), { password: "a-different-password", rounds: 10 });

    const after = await prisma().user.findUniqueOrThrow({
      where: { email: "supervisor@example.com" },
    });

    expect(after.passwordHash).toBe(before.passwordHash);
  });

  it("restores the documented role if it was changed", async () => {
    await seedDemoAccounts(prisma(), config);
    await prisma().user.update({
      where: { email: "supervisor@example.com" },
      data: { role: "OPERATOR" },
    });

    const outcomes = await seedDemoAccounts(prisma(), config);

    expect(
      outcomes.some(
        (outcome) => outcome.email === "supervisor@example.com" && outcome.status === "role-updated",
      ),
    ).toBe(true);

    const restored = await prisma().user.findUniqueOrThrow({
      where: { email: "supervisor@example.com" },
    });
    expect(restored.role).toBe("SUPERVISOR");
  });
});
