/**
 * Product endpoints.
 *
 * Contract: `docs/openapi.yaml` — `GET /api/v1/products` (both roles) and
 * `POST /api/v1/products` (`x-required-role: SUPERVISOR`).
 *
 * The `x-required-role` extension is documentation metadata. Authorisation is
 * enforced here with `requireRole`, per `AGENTS.md` §6.
 */
import { Router } from "express";

import type { PrismaClient } from "@prisma/client";

import { createProductRequestSchema, listProductsQuerySchema } from "../../lib/validation.js";
import type { TokenService } from "../../lib/tokens.js";
import { createAuthenticateMiddleware, requireRole } from "../../middleware/auth.js";
import { createProduct, listProducts } from "./service.js";

export interface ProductRouterOptions {
  readonly prisma: PrismaClient;
  readonly tokens: TokenService;
}

export function createProductRouter({ prisma, tokens }: ProductRouterOptions): Router {
  const router = Router();
  const authenticate = createAuthenticateMiddleware(tokens);

  // Both OPERATOR and SUPERVISOR may list products (`docs/prd.md` permission
  // matrix). Authentication is still required.
  router.get("/products", authenticate, async (request, response) => {
    const query = listProductsQuerySchema.parse(request.query);
    const result = await listProducts(prisma, {
      page: query.page,
      limit: query.limit,
      search: query.search,
    });

    response.status(200).json({
      data: result.products,
      meta: { page: result.page, limit: result.limit, total: result.total },
    });
  });

  router.post(
    "/products",
    authenticate,
    requireRole("SUPERVISOR"),
    async (request, response) => {
      const input = createProductRequestSchema.parse(request.body ?? {});
      const product = await createProduct(prisma, input);

      response.status(201).json({ data: product });
    },
  );

  return router;
}
