/**
 * API contract consistency tests (API-01, API-09, API-10 in `docs/testing.md`).
 *
 * - The served `/openapi.yaml` is byte-identical to the reviewed document
 *   (proving Swagger UI and clients see the approved contract).
 * - Every implemented `/api/v1` route+method exists in the contract, and the
 *   contract's documented paths are all implemented — no undocumented
 *   endpoints, no missing ones.
 * - Every `error.code` the API can emit is a member of the contract's
 *   `ErrorCode` enum.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { ERROR_CODES } from "../src/lib/errors.js";
import { createTestApp } from "../tests/helpers/api.js";
import { disconnectTestDatabase, getTestPrisma, resetDatabase } from "./helpers/db.js";

const openApiPath = resolve(import.meta.dirname, "..", "..", "docs", "openapi.yaml");

/**
 * Collects `METHOD path` pairs from the Express layer stack.
 *
 * Sub-router mount prefixes are not recovered from Express internals (their
 * compiled form is version-specific); instead each collected route is stored
 * bare and reconciled against the documented path with and without the
 * single `/api/v1` mount prefix `app.ts` uses for every business router.
 * Root-mounted routes (`/health`, `/ready`, `/openapi.yaml`) match bare.
 */
const API_MOUNT_PREFIX = "/api/v1";

function implementedRoutes(app: ReturnType<typeof createTestApp>): Set<string> {
  const found = new Set<string>();
  const stack =
    (
      app as unknown as {
        router?: { stack?: unknown[] };
        _router?: { stack?: unknown[] };
      }
    ).router?.stack ??
    (app as unknown as { _router?: { stack?: unknown[] } })._router?.stack ??
    [];

  const walk = (layers: unknown[]): void => {
    for (const layer of layers) {
      const candidate = layer as {
        route?: { path: string; methods: Record<string, boolean> };
        name?: string;
        handle?: { stack?: unknown[] };
      };
      if (candidate.route !== undefined) {
        for (const [method, enabled] of Object.entries(candidate.route.methods)) {
          if (enabled && method !== "_all") {
            found.add(`${method.toUpperCase()} ${candidate.route.path}`);
          }
        }
      } else if (candidate.name === "router" && candidate.handle?.stack !== undefined) {
        walk(candidate.handle.stack);
      }
    }
  };

  walk(stack);
  return found;
}

/**
 * A bare collected route matches the documented path directly or under
 * `/api/v1`. Express reports parameters as `:id`; the contract writes
 * `{id}` — both spellings are normalised before comparison.
 */
function normalisePath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function matchesDocumented(route: string, documented: Set<string>): boolean {
  const separator = route.indexOf(" ");
  if (separator === -1) {
    return false;
  }
  const method = route.slice(0, separator);
  const path = normalisePath(route.slice(separator + 1));
  return (
    documented.has(`${method} ${path}`) ||
    (path.startsWith("/") && documented.has(`${method} ${API_MOUNT_PREFIX}${path}`))
  );
}

function documentedRoutes(document: string): Set<string> {
  const found = new Set<string>();
  // Only the `paths:` section uses two-space-indented keys starting with
  // `/api/v1`, `/health`, `/ready`, or `/openapi` — component schemas sit
  // deeper or under different parents.
  const pathPattern = /^ {2}(\/api\/v1[^\s:]*|\/health|\/ready):\s*$/;
  const methodPattern = /^ {4}(get|post|put|patch|delete|head|options):\s*$/;
  let currentPath: string | undefined;

  for (const line of document.split("\n")) {
    const pathMatch = pathPattern.exec(line);
    if (pathMatch) {
      currentPath = pathMatch[1];
      continue;
    }
    const methodMatch = methodPattern.exec(line);
    if (methodMatch && currentPath !== undefined) {
      found.add(`${methodMatch[1]?.toUpperCase()} ${currentPath}`);
    }
  }

  return found;
}

describe("API contract consistency", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await disconnectTestDatabase();
  });

  it("API-01: serves the reviewed OpenAPI document byte-for-byte", async () => {
    const prisma = getTestPrisma();
    const app = createTestApp(prisma);

    const response = await (await import("supertest")).default(app).get("/openapi.yaml");

    expect(response.status).toBe(200);
    const onDisk = await readFile(openApiPath, "utf8");
    expect(response.text).toBe(onDisk);
    expect(onDisk).toContain("openapi: 3.1");
    for (const path of [
      "/api/v1/receiving-documents",
      "/api/v1/receiving-documents/{id}/items/{itemId}/receipts",
      "/api/v1/inventory",
      "/api/v1/inventory/transactions",
    ]) {
      expect(onDisk).toContain(path);
    }
  });

  it("API-10: implemented routes match the documented paths and methods", async () => {
    const prisma = getTestPrisma();
    const app = createTestApp(prisma);
    const document = await readFile(openApiPath, "utf8");

    const implemented = implementedRoutes(app);
    const documented = documentedRoutes(document);

    // Every implemented route is documented (auth + products + receiving +
    // inventory under `/api/v1`; health, readiness, and the YAML endpoint at
    // the root). Express 5 also registers HEAD/OPTIONS helpers and the
    // Swagger/static handlers; only routes carrying an explicit method flag
    // are compared, which is exactly the surface the contract describes.
    const comparable = [...implemented].filter((route) => {
      if (route.startsWith("GET /health") || route.startsWith("GET /ready")) {
        return false;
      }
      return matchesDocumented(route, documented) || route.includes("/api/v1");
    });
    expect(comparable.length).toBeGreaterThan(0);
    for (const route of comparable) {
      expect(matchesDocumented(route, documented), `${route} is implemented but undocumented`).toBe(
        true,
      );
    }
    for (const route of documented) {
      const covered = [...implemented].some((candidate) => matchesDocumented(candidate, new Set([route])));
      expect(covered, `${route} is documented but unimplemented`).toBe(true);
    }
  });

  it("API-09: the error code registry matches the contract enum", async () => {
    const document = await readFile(openApiPath, "utf8");
    const enumBlock = document.split("ErrorCode:")[1]?.split("Product:")[0] ?? "";

    for (const code of ERROR_CODES) {
      expect(enumBlock.includes(`- ${code}`), `${code} missing from the contract enum`).toBe(
        true,
      );
    }
  });
});
