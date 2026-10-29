import fs from "node:fs";

import cors from "cors";
import express, { type Express, type RequestHandler } from "express";
import swaggerUi from "swagger-ui-express";

import type { PrismaClient } from "@prisma/client";

import type { AppConfig } from "./config/index.js";
import { createErrorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { createTokenService } from "./lib/tokens.js";
import { createAuthRouter } from "./modules/auth/routes.js";
import { createInventoryRouter } from "./modules/inventory/routes.js";
import { createProductRouter } from "./modules/products/routes.js";
import { createReceivingRouter } from "./modules/receiving/routes.js";
import { createHealthRouter, createOpenApiRouter } from "./routes/health.js";

export interface CreateAppOptions {
  config: AppConfig;
  /** Readiness probe. Injected so tests can run without a database. */
  checkDatabase: () => Promise<boolean>;
  /** Data access used by the `/api/v1` business routes. */
  prisma: PrismaClient;
}

/**
 * Builds the Express application without binding a port.
 *
 * Kept separate from `server.ts` so tests can exercise the HTTP surface with
 * Supertest and no listening socket.
 */
export function createApp({ config, checkDatabase, prisma }: CreateAppOptions): Express {
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

  // Business routes. `/api/v1` is prefix-mounted here so each router only
  // declares the paths the contract documents.
  const tokens = createTokenService({
    secret: config.jwtSecret,
    expiresInSeconds: config.jwtExpiresInSeconds,
  });

  app.use("/api/v1", createAuthRouter({ prisma, tokens }));
  app.use("/api/v1", createProductRouter({ prisma, tokens }));
  app.use("/api/v1", createReceivingRouter({ prisma, tokens }));
  app.use("/api/v1", createInventoryRouter({ prisma, tokens }));

  app.use(notFoundHandler);
  app.use(createErrorHandler({ isProduction: config.isProduction }));

  return app;
}
