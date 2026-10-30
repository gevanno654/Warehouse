import { describe, expect, it } from "vitest";

import { ConfigurationError, jwtExpiresInSeconds, parseEnv } from "../src/config/env.js";

const validEnv = {
  NODE_ENV: "test",
  PORT: "3000",
  DATABASE_URL: "postgresql://app:app_password@localhost:5432/warehouse",
  CORS_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "test-only-signing-secret-value",
  JWT_EXPIRES_IN: "1h",
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
      JWT_SECRET: validEnv.JWT_SECRET,
      JWT_EXPIRES_IN: validEnv.JWT_EXPIRES_IN,
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

  it("requires JWT_SECRET", () => {
    const { JWT_SECRET: _omitted, ...withoutSecret } = validEnv;

    expect(() => parseEnv(withoutSecret)).toThrow(/JWT_SECRET is required/);
  });

  it("rejects a JWT_SECRET shorter than 16 characters", () => {
    expect(() => parseEnv({ ...validEnv, JWT_SECRET: "too-short" })).toThrow(
      /JWT_SECRET must be at least 16 characters/,
    );
  });

  it("requires JWT_EXPIRES_IN", () => {
    const { JWT_EXPIRES_IN: _omitted, ...withoutExpiry } = validEnv;

    expect(() => parseEnv(withoutExpiry)).toThrow(/JWT_EXPIRES_IN is required/);
  });

  it.each(["1h", "30m", "3600s", "7d"])("accepts the JWT lifetime %s", (value) => {
    expect(parseEnv({ ...validEnv, JWT_EXPIRES_IN: value }).JWT_EXPIRES_IN).toBe(value);
  });

  it.each(["1", "h", "1hh", "-1h", "1.5h", "1 h"])(
    "rejects the malformed JWT lifetime %s",
    (value) => {
      expect(() => parseEnv({ ...validEnv, JWT_EXPIRES_IN: value })).toThrow(
        /JWT_EXPIRES_IN must be a positive integer/,
      );
    },
  );

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

describe("jwtExpiresInSeconds", () => {
  it.each([
    ["3600s", 3600],
    ["30m", 1800],
    ["1h", 3600],
    ["7d", 604_800],
  ])("converts %s to %i seconds", (value, expected) => {
    expect(jwtExpiresInSeconds(value)).toBe(expected);
  });

  it("rejects a zero lifetime", () => {
    expect(() => jwtExpiresInSeconds("0h")).toThrow(ConfigurationError);
  });

  it("rejects a malformed lifetime", () => {
    expect(() => jwtExpiresInSeconds("one hour")).toThrow(ConfigurationError);
  });
});
