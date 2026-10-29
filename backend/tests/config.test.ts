import { describe, expect, it } from "vitest";

import { ConfigurationError, parseEnv } from "../src/config/env.js";

const validEnv = {
  NODE_ENV: "test",
  PORT: "3000",
  DATABASE_URL: "postgresql://app:app_password@localhost:5432/warehouse",
  CORS_ORIGIN: "http://localhost:5173",
};

describe("parseEnv", () => {
  it("accepts a valid environment", () => {
    const env = parseEnv(validEnv);

    expect(env.NODE_ENV).toBe("test");
    expect(env.PORT).toBe(3000);
    expect(env.CORS_ORIGIN).toBe("http://localhost:5173");
  });

  it("applies documented defaults for NODE_ENV and PORT", () => {
    const env = parseEnv({
      DATABASE_URL: validEnv.DATABASE_URL,
      CORS_ORIGIN: validEnv.CORS_ORIGIN,
    });

    expect(env.NODE_ENV).toBe("development");
    expect(env.PORT).toBe(3000);
  });

  it("fails when DATABASE_URL is missing", () => {
    expect(() => parseEnv({ CORS_ORIGIN: validEnv.CORS_ORIGIN })).toThrow(ConfigurationError);
  });

  it("fails when DATABASE_URL is not a PostgreSQL connection string", () => {
    expect(() =>
      parseEnv({ ...validEnv, DATABASE_URL: "mysql://app:secret@localhost:3306/warehouse" }),
    ).toThrow(/DATABASE_URL must be a PostgreSQL connection string/);
  });

  it("fails when CORS_ORIGIN is not an absolute origin", () => {
    expect(() => parseEnv({ ...validEnv, CORS_ORIGIN: "localhost:5173" })).toThrow(/CORS_ORIGIN/);
  });

  it("rejects a non-numeric PORT", () => {
    expect(() => parseEnv({ ...validEnv, PORT: "abc" })).toThrow(/PORT/);
  });

  it("rejects an out-of-range PORT", () => {
    expect(() => parseEnv({ ...validEnv, PORT: "70000" })).toThrow(/PORT must be between 1 and 65535/);
  });

  it("treats a blank value as absent so defaults still apply", () => {
    const env = parseEnv({ ...validEnv, PORT: "  " });

    expect(env.PORT).toBe(3000);
  });

  it("rejects a blank required value", () => {
    expect(() => parseEnv({ ...validEnv, DATABASE_URL: "   " })).toThrow(/DATABASE_URL is required/);
  });

  it("rejects an unknown NODE_ENV", () => {
    expect(() => parseEnv({ ...validEnv, NODE_ENV: "staging" })).toThrow(/NODE_ENV/);
  });

  it("enforces the documented bcrypt minimum work factor", () => {
    expect(() => parseEnv({ ...validEnv, BCRYPT_ROUNDS: "8" })).toThrow(/minimum is 10/);
    expect(parseEnv({ ...validEnv, BCRYPT_ROUNDS: "12" }).BCRYPT_ROUNDS).toBe(12);
  });

  it("reports every problem at once", () => {
    try {
      parseEnv({ NODE_ENV: "staging" });
      expect.unreachable("expected a ConfigurationError");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      const issues = (error as ConfigurationError).issues.join("\n");
      expect(issues).toContain("DATABASE_URL");
      expect(issues).toContain("CORS_ORIGIN");
      expect(issues).toContain("NODE_ENV");
    }
  });
});
