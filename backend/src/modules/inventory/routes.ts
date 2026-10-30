/**
 * Inventory endpoints.
 *
 * Contract: `docs/openapi.yaml` — `GET /api/v1/inventory` and
 * `GET /api/v1/inventory/transactions`. Both roles may read; authentication
 * is required.
 */
import { Router } from "express";

import type { PrismaClient } from "@prisma/client";

import type { TokenService } from "../../lib/tokens.js";
import {
  listInventoryQuerySchema,
  listInventoryTransactionsQuerySchema,
} from "../../lib/validation.js";
import { createAuthenticateMiddleware } from "../../middleware/auth.js";
import { listInventory, listInventoryTransactions } from "./service.js";

export interface InventoryRouterOptions {
  readonly prisma: PrismaClient;
  readonly tokens: TokenService;
}

export function createInventoryRouter({
  prisma,
  tokens,
}: InventoryRouterOptions): Router {
  const router = Router();
  const authenticate = createAuthenticateMiddleware(tokens);

  router.get("/inventory", authenticate, async (request, response) => {
    const query = listInventoryQuerySchema.parse(request.query);
    const result = await listInventory(prisma, {
      page: query.page,
      limit: query.limit,
      search: query.search,
    });

    response.status(200).json({
      data: result.items,
      meta: { page: result.page, limit: result.limit, total: result.total },
    });
  });

  router.get("/inventory/transactions", authenticate, async (request, response) => {
    const query = listInventoryTransactionsQuerySchema.parse(request.query);
    const result = await listInventoryTransactions(prisma, {
      page: query.page,
      limit: query.limit,
      productId: query.productId,
      from: query.from === undefined ? undefined : new Date(query.from),
      to: query.to === undefined ? undefined : new Date(query.to),
    });

    response.status(200).json({
      data: result.transactions,
      meta: { page: result.page, limit: result.limit, total: result.total },
    });
  });

  return router;
}
