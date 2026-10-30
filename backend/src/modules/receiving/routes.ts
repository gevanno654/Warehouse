/**
 * Receiving document and receipt endpoints.
 *
 * Contract: `docs/openapi.yaml` — `GET /api/v1/receiving-documents`,
 * `POST /api/v1/receiving-documents`, `GET /api/v1/receiving-documents/{id}`,
 * `POST /api/v1/receiving-documents/{id}/items/{itemId}/receipts`.
 *
 * Both roles may list, create, view, and receive; authentication is required
 * everywhere. The `x-required-role` extension in the OpenAPI document is
 * documentation metadata and is not read here.
 */
import { Router } from "express";

import type { PrismaClient } from "@prisma/client";

import { notFoundError } from "../../lib/errors.js";
import type { TokenService } from "../../lib/tokens.js";
import {
  createReceivingDocumentRequestSchema,
  listReceivingDocumentsQuerySchema,
  parseIdempotencyKey,
  parseOrQuantityError,
  parseUuidParams,
  recordReceiptRequestSchema,
} from "../../lib/validation.js";
import {
  createAuthenticateMiddleware,
  getAuthenticatedUser,
} from "../../middleware/auth.js";
import {
  createReceivingDocument,
  getReceivingDocument,
  listReceivingDocuments,
  recordReceipt,
} from "./service.js";

export interface ReceivingRouterOptions {
  readonly prisma: PrismaClient;
  readonly tokens: TokenService;
}

export function createReceivingRouter({
  prisma,
  tokens,
}: ReceivingRouterOptions): Router {
  const router = Router();
  const authenticate = createAuthenticateMiddleware(tokens);

  router.get("/receiving-documents", authenticate, async (request, response) => {
    const query = listReceivingDocumentsQuerySchema.parse(request.query);

    const result = await listReceivingDocuments(prisma, {
      page: query.page,
      limit: query.limit,
      status: query.status,
      search: query.search,
    });

    response.status(200).json({
      data: result.documents,
      meta: { page: result.page, limit: result.limit, total: result.total },
    });
  });

  router.post("/receiving-documents", authenticate, async (request, response) => {
    const user = getAuthenticatedUser(request);
    const input = parseOrQuantityError(
      createReceivingDocumentRequestSchema,
      request.body ?? {},
    );
    const document = await createReceivingDocument(prisma, {
      items: input.items,
      createdBy: user.id,
    });

    response.status(201).json({ data: document });
  });

  router.get("/receiving-documents/:id", authenticate, async (request, response) => {
    const params = parseUuidParams(request.params);
    const document = await getReceivingDocument(prisma, params.id);

    if (document === undefined) {
      throw notFoundError();
    }

    response.status(200).json({ data: document });
  });

  router.post(
    "/receiving-documents/:id/items/:itemId/receipts",
    authenticate,
    async (request, response) => {
      const user = getAuthenticatedUser(request);
      // Schema-level rejections happen before the transaction begins: a
      // missing header is `IDEMPOTENCY_KEY_REQUIRED`, a bad quantity is
      // `INVALID_QUANTITY`, anything else structural is `VALIDATION_ERROR`.
      const idempotencyKey = parseIdempotencyKey(request.headers["idempotency-key"]);
      const params = parseUuidParams(request.params);
      const body = parseOrQuantityError(recordReceiptRequestSchema, request.body ?? {});

      const outcome = await recordReceipt(prisma, {
        documentId: params.id,
        itemId: params.itemId ?? "",
        quantity: body.quantity,
        performedBy: user.id,
        idempotencyKey,
      });

      response.status(outcome.replayed ? 200 : 201).json({ data: outcome.result });
    },
  );

  return router;
}
