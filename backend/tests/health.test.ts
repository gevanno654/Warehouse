import { resolve } from "node:path";

import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "@prisma/client";

import { createApp } from "../src/app.js";
import type { AppConfig } from "../src/config/index.js";

const openApiDocumentPath = resolve(import.meta.dirname, "..", "..", "docs", "openapi.yaml");

interface ErrorResponseBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

/** Supertest types `body` as `any`; narrow it once instead of per assertion. */
function asErrorBody(body: unknown): ErrorResponseBody {
  return body as ErrorResponseBody;
}

function buildConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    nodeEnv: "test",
    isProduction: false,
    port: 3000,
    databaseUrl: "postgresql://app:app_password@localhost:5432/warehouse",
    corsOrigin: "http://localhost:5173",
    openApiDocumentPath,
    jwtSecret: "test-only-signing-secret-value",
    jwtExpiresInSeconds: 3600,
    ...overrides,
  };
}

/**
 * These tests never reach a business route, so the data client is never
 * queried. Injecting a stub keeps the suite runnable without PostgreSQL.
 */
const unusedPrisma = {} as unknown as PrismaClient;

type DatabaseProbe = () => Promise<boolean>;

const databaseUp: DatabaseProbe = () => Promise.resolve(true);
const databaseDown: DatabaseProbe = () => Promise.resolve(false);

function createTestApp(
  checkDatabase: DatabaseProbe = databaseUp,
  overrides: Partial<AppConfig> = {},
) {
  return createApp({ config: buildConfig(overrides), checkDatabase, prisma: unusedPrisma });
}

describe("GET /health", () => {
  it("returns 200 with the contracted liveness body", async () => {
    const response = await request(createTestApp()).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });

  it("does not depend on the database", async () => {
    const checkDatabase = vi.fn<DatabaseProbe>(databaseDown);

    const response = await request(createTestApp(checkDatabase)).get("/health");

    expect(response.status).toBe(200);
    expect(checkDatabase).not.toHaveBeenCalled();
  });

  it("is reachable without authentication", async () => {
    const response = await request(createTestApp()).get("/health");

    expect(response.status).toBe(200);
    expect(response.headers["www-authenticate"]).toBeUndefined();
  });
});

describe("GET /ready", () => {
  it("returns 200 and the connected state when the database is reachable", async () => {
    const response = await request(createTestApp(databaseUp)).get("/ready");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ready", database: "connected" });
  });

  it("returns 503 SERVICE_UNAVAILABLE when the database is unreachable", async () => {
    const response = await request(createTestApp(databaseDown)).get("/ready");

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      error: {
        code: "SERVICE_UNAVAILABLE",
        message: "A required dependency is unavailable.",
      },
    });
  });

  it("does not leak the underlying connection error", async () => {
    const response = await request(createTestApp(databaseDown)).get("/ready");

    expect(JSON.stringify(response.body)).not.toMatch(
      /password|postgres|prisma|ECONNREFUSED/i,
    );
  });
});

describe("API documentation", () => {
  it("serves the approved OpenAPI document unmodified at /openapi.yaml", async () => {
    const response = await request(createTestApp()).get("/openapi.yaml");

    expect(response.status).toBe(200);
    expect(response.text).toContain("openapi: 3.1.0");
    expect(response.text).toContain("/ready:");
  });

  it("serves Swagger UI at /docs", async () => {
    const response = await request(createTestApp()).get("/docs/");

    expect(response.status).toBe(200);
    expect(response.text).toContain("swagger-ui");
  });
});

describe("error handling", () => {
  it("returns 404 NOT_FOUND for an unknown route", async () => {
    const response = await request(createTestApp()).get("/api/v1/unknown");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: {
        code: "NOT_FOUND",
        message: "The requested resource does not exist.",
      },
    });
  });

  it("returns 400 VALIDATION_ERROR for a malformed JSON body", async () => {
    const response = await request(createTestApp())
      .post("/api/v1/unknown")
      .set("Content-Type", "application/json")
      .send("{ not json");

    expect(response.status).toBe(400);
    expect(asErrorBody(response.body).error.code).toBe("VALIDATION_ERROR");
  });

  it("hides internal details in production", async () => {
    const app = createApp({
      config: buildConfig({ nodeEnv: "production", isProduction: true }),
      checkDatabase: () => {
        throw new Error("secret-internal-detail");
      },
      prisma: unusedPrisma,
    });

    const response = await request(app).get("/ready");
    const body = asErrorBody(response.body);

    expect(response.status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(body)).not.toContain("secret-internal-detail");
    expect(body.error.details).toBeUndefined();
  });
});
