import fs from "node:fs";

import cors from "cors";
import express, { type Express, type RequestHandler } from "express";
import swaggerUi from "swagger-ui-express";

import type { AppConfig } from "./config/index.js";
import { createErrorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { createHealthRouter, createOpenApiRouter } from "./routes/health.js";

export interface CreateAppOptions {
  config: AppConfig;
  /** Readiness probe. Injected so tests can run without a database. */
  checkDatabase: () => Promise<boolean>;
}

/**
 * Builds the Express application without binding a port.
 *
 * Kept separate from `server.ts` so tests can exercise the HTTP surface with
 * Supertest and no listening socket.
 */
export function createApp({ config, checkDatabase }: CreateAppOptions): Express {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", true);

  app.use(
    cors({
      // Single approved browser origin; see `CORS_ORIGIN` in `.env.example`.
      origin: config.corsOrigin,
      methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key"],
      maxAge: 600,
    }) as RequestHandler,
  );

  app.use(express.json({ limit: "1mb" }));

  app.use(createHealthRouter({ checkDatabase }));
  app.use(createOpenApiRouter(config.openApiDocumentPath));

  // Swagger UI renders the shell and fetches the document from
  // `/openapi.yaml`, so the approved spec is served unmodified and no YAML
  // parser is required at runtime.
  if (fs.existsSync(config.openApiDocumentPath)) {
    app.use(
      "/docs",
      swaggerUi.serve,
      swaggerUi.setup(undefined, {
        swaggerOptions: { url: "/openapi.yaml" },
        customSiteTitle: "Warehouse Receiving System API",
      }),
    );
  }

  // Business routes are mounted under `/api/v1` in a later phase.

  app.use(notFoundHandler);
  app.use(createErrorHandler({ isProduction: config.isProduction }));

  return app;
}
