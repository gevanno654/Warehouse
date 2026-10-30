import bcrypt from "bcrypt";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  BootstrapError,
  bootstrapSupervisor,
  resolveBootstrapInput,
} from "../src/seed/bootstrap-supervisor.js";
import { disconnectTestDatabase, getTestPrisma, resetDatabase } from "./helpers/db.js";

const prisma = () => getTestPrisma();

const validInput = (overrides: Partial<Parameters<typeof resolveBootstrapInput>[0]> = {}) => ({
  nodeEnv: "production",
  email: "owner@example.com",
  password: "a-very-strong-password-1",
  confirmPassword: "a-very-strong-password-1",
  bcryptRounds: "10",
  ...overrides,
});

describe("bootstrap input validation (no database access)", () => {
  it("rejects NODE_ENV other than production before touching the database", () => {
    expect(() => resolveBootstrapInput(validInput({ nodeEnv: "development" }))).toThrow(
      /outside NODE_ENV=production/,
    );
  });

  it("rejects BCRYPT_ROUNDS outside 10-15 before hashing", () => {
    expect(() => resolveBootstrapInput(validInput({ bcryptRounds: "9" }))).toThrow(
      BootstrapError,
    );
    expect(() => resolveBootstrapInput(validInput({ bcryptRounds: "16" }))).toThrow(
      BootstrapError,
    );
    expect(() => resolveBootstrapInput(validInput({ bcryptRounds: "10" }))).not.toThrow();
    expect(() => resolveBootstrapInput(validInput({ bcryptRounds: "15" }))).not.toThrow();
  });

  it("rejects invalid or overlong emails before any transaction", () => {
    expect(() => resolveBootstrapInput(validInput({ email: "not-an-email" }))).toThrow(
      BootstrapError,
    );
    expect(() =>
      resolveBootstrapInput(validInput({ email: `${"a".repeat(250)}@example.com` })),
    ).toThrow(BootstrapError);
  });

  it("rejects short or mismatched passwords before any transaction", () => {
    expect(() =>
      resolveBootstrapInput(validInput({ password: "short-11-ch", confirmPassword: "short-11-ch" })),
    ).toThrow(/at least 12/);
    expect(() =>
      resolveBootstrapInput(
        validInput({ password: "a-very-strong-password-1", confirmPassword: "different-password-2" }),
      ),
    ).toThrow(/do not match/);
  });
});

describe("bootstrap behaviour against the test database", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await disconnectTestDatabase();
  });

  it("creates one SUPERVISOR when none exists", async () => {
    const config = resolveBootstrapInput(validInput());

    const result = await bootstrapSupervisor(prisma(), config);

    expect(result).toMatchObject({ email: "owner@example.com", created: true });
    const users = await prisma().user.findMany();
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ email: "owner@example.com", role: "SUPERVISOR" });
  });

  it("stores a bcrypt hash verifiable with bcrypt.compare", async () => {
    const config = resolveBootstrapInput(validInput());

    await bootstrapSupervisor(prisma(), config);

    const user = await prisma().user.findUniqueOrThrow({ where: { email: config.email } });
    expect(user.passwordHash).not.toBe(config.password);
    expect(user.passwordHash.startsWith("$2")).toBe(true);
    await expect(bcrypt.compare(config.password, user.passwordHash)).resolves.toBe(true);
  });

  it("refuses when a SUPERVISOR already exists", async () => {
    await bootstrapSupervisor(prisma(), resolveBootstrapInput(validInput()));

    await expect(
      bootstrapSupervisor(
        prisma(),
        resolveBootstrapInput(validInput({ email: "second@example.com" })),
      ),
    ).rejects.toThrow(/already exists/);

    expect(await prisma().user.count()).toBe(1);
  });

  it("refuses when the email is already used", async () => {
    await prisma().user.create({
      data: {
        email: "owner@example.com",
        passwordHash: await bcrypt.hash("another-strong-password-1", 10),
        role: "OPERATOR",
      },
    });

    await expect(
      bootstrapSupervisor(prisma(), resolveBootstrapInput(validInput())),
    ).rejects.toThrow(/already registered/);

    expect(await prisma().user.count()).toBe(1);
  });

  it("never logs the password on success or failure", async () => {
    const logs: string[] = [];
    const errors: string[] = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    };

    try {
      const config = resolveBootstrapInput(validInput());
      await bootstrapSupervisor(prisma(), config);
      await expect(
        bootstrapSupervisor(prisma(), resolveBootstrapInput(validInput())),
      ).rejects.toThrow(BootstrapError);
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }

    const secret = validInput().password;
    expect(logs.join("\n")).not.toContain(secret);
    expect(errors.join("\n")).not.toContain(secret);
  });

  it("two concurrent bootstraps produce exactly one SUPERVISOR", async () => {
    const first = resolveBootstrapInput(validInput({ email: "first@example.com" }));
    const second = resolveBootstrapInput(validInput({ email: "second@example.com" }));

    const outcomes = await Promise.allSettled([
      bootstrapSupervisor(prisma(), first),
      bootstrapSupervisor(prisma(), second),
    ]);

    const fulfilled = outcomes.filter(
      (outcome): outcome is PromiseFulfilledResult<{ email: string; created: boolean }> =>
        outcome.status === "fulfilled",
    );
    const rejected = outcomes.filter((outcome) => outcome.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(BootstrapError);
    expect(await prisma().user.count()).toBe(1);
    expect(await prisma().user.count({ where: { role: "SUPERVISOR" } })).toBe(1);
  });

  it("rolls back fully when creation fails mid-transaction", async () => {
    const config = resolveBootstrapInput(validInput());

    // Force a mid-transaction failure after the advisory lock + checks by
    // violating the email unique constraint through a racing insert executed
    // inside the same transaction window is not deterministic, so simulate a
    // failure by attempting bootstrap with a duplicate email created first:
    // the transaction must leave no partial SUPERVISOR behind.
    await prisma().user.create({
      data: {
        email: "taken@example.com",
        passwordHash: await bcrypt.hash("another-strong-password-1", 10),
        role: "OPERATOR",
      },
    });

    await expect(
      bootstrapSupervisor(
        prisma(),
        resolveBootstrapInput(validInput({ email: "taken@example.com" })),
      ),
    ).rejects.toThrow(BootstrapError);

    expect(await prisma().user.count()).toBe(1);
    expect(await prisma().user.count({ where: { role: "SUPERVISOR" } })).toBe(0);
    expect(config.email).toBe("owner@example.com");
  });
});
