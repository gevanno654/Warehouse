import { readFile } from "node:fs/promises";

import { Router } from "express";

export interface HealthRouterOptions {
  /** Resolves `true` when PostgreSQL accepts a query. Must not throw. */
  checkDatabase: () => Promise<boolean>;
}

/**
 * Liveness and readiness endpoints.
 *
 * Contract: `docs/openapi.yaml` (`/health`, `/ready`). Both are public
 * (`security: []`) and are served at the API root, not under `/api/v1`.
 */
export function createHealthRouter(options: HealthRouterOptions): Router {
  const router = Router();

  router.get("/health", (_request, response) => {
    response.status(200).json({ status: "ok" });
  });

  router.get("/ready", async (_request, response) => {
    const connected = await options.checkDatabase();

    if (!connected) {
      // Readiness fails closed: a running process is not proof that the
      // database is reachable.
      response.status(503).json({
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "A required dependency is unavailable.",
        },
      });
      return;
    }

    response.status(200).json({ status: "ready", database: "connected" });
  });

  return router;
}

/**
 * Serves the approved OpenAPI document byte-for-byte.
 *
 * The file is read per request and never rewritten, so the runtime contract is
 * always the reviewed document in `docs/openapi.yaml`.
 */
export function createOpenApiRouter(documentPath: string): Router {
  const router = Router();

  router.get("/openapi.yaml", async (_request, response) => {
    try {
      const document = await readFile(documentPath, "utf8");
      response.status(200).type("application/yaml").send(document);
    } catch {
      response.status(503).json({
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "The API documentation is unavailable.",
        },
      });
    }
  });

  return router;
}
