/**
 * Receiving document management and receipt processing.
 *
 * Business rules from `docs/prd.md` FR-03/FR-04 and the exact processing
 * order in `docs/technical-spec.md` §5.6/§6.3:
 * - Documents and items are created atomically; the backend generates
 *   `document_number` (`RCV-<YYYYMMDD>-<000001>`) from the
 *   `receiving_document_number_seq` sequence, retrying a unique violation up
 *   to 3 times before `500`.
 * - Receipts run in a single transaction with row locks acquired in the fixed
 *   order `receiving_documents` → `receiving_items` → `inventories`.
 * - The idempotency check precedes the completed-document and
 *   remaining-quantity checks, so a legitimate replay still returns the
 *   stored success after the document becomes `COMPLETED`.
 * - Document status is recalculated from all items read after the document
 *   lock is held, never from a pre-lock read.
 */
import { createHash } from "node:crypto";

import { Prisma, type PrismaClient, type ReceivingDocumentStatus } from "@prisma/client";

import {
  documentAlreadyCompletedError,
  duplicateDocumentItemError,
  idempotencyKeyConflictError,
  productsNotFoundError,
  receiptExceedsRemainingError,
  receivingNotFoundError,
} from "../../lib/errors.js";
import { assertPositiveInteger } from "../../lib/validation.js";

/** Bounded retries for a document-number unique collision (§5.5). */
const DOCUMENT_NUMBER_MAX_ATTEMPTS = 3;

export interface ReceivingItemView {
  readonly id: string;
  readonly productId: string;
  readonly sku: string;
  readonly productName: string;
  readonly expectedQuantity: number;
  readonly receivedQuantity: number;
  readonly remainingQuantity: number;
}

export interface ReceivingDocumentView {
  readonly id: string;
  readonly documentNumber: string;
  readonly status: ReceivingDocumentStatus;
  readonly createdBy: { id: string; email: string; role: string };
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly totalItems: number;
  readonly totalExpectedQuantity: number;
  readonly totalReceivedQuantity: number;
  readonly items: readonly ReceivingItemView[];
}

export interface ReceivingDocumentSummaryView {
  readonly id: string;
  readonly documentNumber: string;
  readonly status: ReceivingDocumentStatus;
  readonly createdAt: Date;
  readonly totalItems: number;
  readonly totalExpectedQuantity: number;
  readonly totalReceivedQuantity: number;
}

export interface ReceiptResultView {
  readonly receiptOperationId: string;
  readonly documentNumber: string;
  readonly itemId: string;
  readonly quantityReceivedNow: number;
  readonly cumulativeReceivedQuantity: number;
  readonly remainingQuantity: number;
  readonly availableStock: number;
  readonly documentStatus: ReceivingDocumentStatus;
}

function toItemView(item: {
  id: string;
  productId: string;
  expectedQuantity: number;
  receivedQuantity: number;
  product: { sku: string; name: string };
}): ReceivingItemView {
  return {
    id: item.id,
    productId: item.productId,
    sku: item.product.sku,
    productName: item.product.name,
    expectedQuantity: item.expectedQuantity,
    receivedQuantity: item.receivedQuantity,
    remainingQuantity: item.expectedQuantity - item.receivedQuantity,
  };
}

function sumBy<T>(rows: readonly T[], pick: (row: T) => number): number {
  return rows.reduce((total, row) => total + pick(row), 0);
}

export function deriveStatus(
  items: readonly { expectedQuantity: number; receivedQuantity: number }[],
): ReceivingDocumentStatus {
  if (items.every((item) => item.receivedQuantity === 0)) {
    return "PENDING";
  }
  if (items.every((item) => item.receivedQuantity === item.expectedQuantity)) {
    return "COMPLETED";
  }
  return "PARTIALLY_RECEIVED";
}

type DocumentWithItems = {
  id: string;
  documentNumber: string;
  status: ReceivingDocumentStatus;
  createdAt: Date;
  updatedAt: Date;
  // Selected explicitly (`select: { id, email, role }` at every query site)
  // so a password hash can never reach the response spread below.
  creator: { id: string; email: string; role: string };
  items: Array<{
    id: string;
    productId: string;
    expectedQuantity: number;
    receivedQuantity: number;
    product: { sku: string; name: string };
  }>;
};

function toDocumentView(document: DocumentWithItems): ReceivingDocumentView {
  const items = document.items.map(toItemView);
  return {
    id: document.id,
    documentNumber: document.documentNumber,
    status: document.status,
    createdBy: {
      id: document.creator.id,
      email: document.creator.email,
      role: document.creator.role,
    },
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    totalItems: items.length,
    totalExpectedQuantity: sumBy(items, (item) => item.expectedQuantity),
    totalReceivedQuantity: sumBy(items, (item) => item.receivedQuantity),
    items,
  };
}

/**
 * Computes the canonical idempotency hash.
 *
 * `sha256(lowercase(method) + "|" + documentId + "|" + itemId + "|"
 * + quantity)` with the resolved route UUIDs and the validated integer
 * quantity, stored as 64 lowercase hex characters (`docs/data-model.md` §6).
 */
export function computeRequestHash(
  documentId: string,
  itemId: string,
  quantity: number,
): string {
  return createHash("sha256")
    .update(`post|${documentId}|${itemId}|${quantity}`, "utf8")
    .digest("hex");
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
  );
}

export interface CreateReceivingDocumentInput {
  readonly items: readonly { productId: string; expectedQuantity: number }[];
  readonly createdBy: string;
}

/**
 * Creates a receiving document and its items atomically.
 *
 * The document number comes from `receiving_document_number_seq` masoned
 * with the UTC date: `RCV-<YYYYMMDD>-<lpad(nextval, 6, '0')>`. The sequence
 * makes collisions impossible in practice; the unique constraint is the
 * final authority, and a collision rolls the whole transaction back and
 * retries, at most 3 attempts, before `500 INTERNAL_ERROR`.
 *
 * @throws {AppError} `400 INVALID_QUANTITY` for a non-positive-integer
 *   expected quantity; `404 NOT_FOUND` for an unknown product;
 *   `409 DUPLICATE_DOCUMENT_ITEM` for a repeated product.
 */
export async function createReceivingDocument(
  prisma: PrismaClient,
  input: CreateReceivingDocumentInput,
): Promise<ReceivingDocumentView> {
  for (const item of input.items) {
    assertPositiveInteger(item.expectedQuantity);
  }

  const productIds = input.items.map((item) => item.productId);
  if (new Set(productIds).size !== productIds.length) {
    throw duplicateDocumentItemError();
  }

  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true },
  });
  if (products.length !== productIds.length) {
    throw productsNotFoundError();
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= DOCUMENT_NUMBER_MAX_ATTEMPTS; attempt += 1) {
    try {
      const created = await prisma.$transaction(async (tx) => {
        // `nextval` runs inside the creation transaction so a rolled-back
        // attempt consumes its number without ever committing a document.
        const sequenceRows = await tx.$queryRaw<Array<{ next: bigint }>>`
          SELECT nextval('receiving_document_number_seq') AS next
        `;
        const sequenceValue = sequenceRows[0]?.next ?? 0n;
        const datePart = new Date().toISOString().slice(0, 10).replaceAll("-", "");
        const documentNumber = `RCV-${datePart}-${String(sequenceValue).padStart(6, "0")}`;

        const document = await tx.receivingDocument.create({
          data: {
            documentNumber,
            createdBy: input.createdBy,
            items: {
              create: input.items.map((item) => ({
                productId: item.productId,
                expectedQuantity: item.expectedQuantity,
              })),
            },
          },
          include: {
            creator: { select: { id: true, email: true, role: true } },
            items: { include: { product: true } },
          },
        });

        return document;
      });

      return toDocumentView(created);
    } catch (error) {
      if (!isUniqueConstraintViolation(error)) {
        throw error;
      }
      lastError = error;
    }
  }

  throw lastError;
}

export interface ListReceivingDocumentsInput {
  readonly page: number;
  readonly limit: number;
  readonly status: ReceivingDocumentStatus | undefined;
  readonly search: string | undefined;
}

export interface ListReceivingDocumentsResult {
  readonly documents: readonly ReceivingDocumentSummaryView[];
  readonly total: number;
  readonly page: number;
  readonly limit: number;
}

/** Lists receiving documents, newest first, with derived totals. */
export async function listReceivingDocuments(
  prisma: PrismaClient,
  input: ListReceivingDocumentsInput,
): Promise<ListReceivingDocumentsResult> {
  const where: Prisma.ReceivingDocumentWhereInput = {
    ...(input.status === undefined ? {} : { status: input.status }),
    // `search` is capped at 50 chars by the route schema; it matches the
    // generated document number (a `contains` search, not a prefix match).
    ...(input.search === undefined
      ? {}
      : { documentNumber: { contains: input.search, mode: "insensitive" } }),
  };

  const [rows, total] = await prisma.$transaction([
    prisma.receivingDocument.findMany({
      where,
      include: { items: true },
      orderBy: { createdAt: "desc" },
      skip: (input.page - 1) * input.limit,
      take: input.limit,
    }),
    prisma.receivingDocument.count({ where }),
  ]);

  return {
    documents: rows.map((row) => ({
      id: row.id,
      documentNumber: row.documentNumber,
      status: row.status,
      createdAt: row.createdAt,
      totalItems: row.items.length,
      totalExpectedQuantity: sumBy(row.items, (item) => item.expectedQuantity),
      totalReceivedQuantity: sumBy(row.items, (item) => item.receivedQuantity),
    })),
    total,
    page: input.page,
    limit: input.limit,
  };
}

/** Returns a document with its items, or `undefined` when unknown. */
export async function getReceivingDocument(
  prisma: PrismaClient,
  id: string,
): Promise<ReceivingDocumentView | undefined> {
  const document = await prisma.receivingDocument.findUnique({
    where: { id },
    include: {
      creator: { select: { id: true, email: true, role: true } },
      items: { include: { product: true } },
    },
  });

  return document === null ? undefined : toDocumentView(document);
}

export interface RecordReceiptInput {
  readonly documentId: string;
  readonly itemId: string;
  readonly quantity: number;
  readonly performedBy: string;
  readonly idempotencyKey: string;
}

export interface RecordReceiptOutcome {
  readonly result: ReceiptResultView;
  /** `true` when the stored snapshot was replayed — the route returns `200`. */
  readonly replayed: boolean;
}

/**
 * Records a receipt in a single transaction (§5.6 steps 3–15).
 *
 * Lock order is fixed: document → item → inventory. The idempotency check
 * runs before the completed-document and remaining-quantity checks. Every
 * check after the transaction begins reads the locked rows, so a request
 * that waited on a lock re-validates against committed values.
 *
 * A `UNIQUE (performed_by, idempotency_key)` violation means a concurrent
 * request committed the same key first: this transaction has already rolled
 * back, so the row is re-read in a fresh transaction and resolved to the
 * stored `200` replay or `409` — never a duplicate write, never the raw
 * database error.
 */
export async function recordReceipt(
  prisma: PrismaClient,
  input: RecordReceiptInput,
): Promise<RecordReceiptOutcome> {
  assertPositiveInteger(input.quantity);
  const requestHash = computeRequestHash(input.documentId, input.itemId, input.quantity);

  try {
    return await prisma.$transaction(async (tx) => {
      // 1. Lock the document row; the lock is held until commit.
      const documents = await tx.$queryRaw<
        Array<{ id: string; document_number: string; status: ReceivingDocumentStatus }>
      >`
        SELECT id, document_number, status
        FROM receiving_documents
        WHERE id = ${input.documentId}::uuid
        FOR UPDATE
      `;
      const document = documents[0];
      if (document === undefined) {
        throw receivingNotFoundError();
      }

      // 2. Lock the item row and verify it belongs to the document.
      const items = await tx.$queryRaw<
        Array<{
          id: string;
          document_id: string;
          product_id: string;
          expected_quantity: number;
          received_quantity: number;
        }>
      >`
        SELECT id, document_id, product_id, expected_quantity, received_quantity
        FROM receiving_items
        WHERE id = ${input.itemId}::uuid
        FOR UPDATE
      `;
      const item = items[0];
      // An item of another document is indistinguishable from a missing one:
      // the item is never resolved across documents (§REC-11).
      if (item === undefined || item.document_id !== document.id) {
        throw receivingNotFoundError();
      }

      // 3. Idempotency check — before any business-rule check.
      const existing = await tx.receiptOperation.findUnique({
        where: {
          performedBy_idempotencyKey: {
            performedBy: input.performedBy,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });
      if (existing !== null) {
        if (
          existing.receivingItemId === input.itemId &&
          existing.quantity === input.quantity &&
          existing.requestHash === requestHash
        ) {
          // Same key, same target and payload: replay, no writes.
          return {
            result: existing.responseSnapshot as unknown as ReceiptResultView,
            replayed: true,
          };
        }
        throw idempotencyKeyConflictError();
      }

      // 4. The document must not be completed.
      if (document.status === "COMPLETED") {
        throw documentAlreadyCompletedError();
      }

      // 5. The quantity must not exceed the remaining quantity, computed
      // from the locked row — never from a pre-lock read.
      const remainingQuantity = item.expected_quantity - item.received_quantity;
      if (input.quantity > remainingQuantity) {
        throw receiptExceedsRemainingError(remainingQuantity);
      }

      // 6. Lock the inventory row for the product. Document/item locks alone
      // cannot serialise two receipts for the same product in different
      // documents, so this lock prevents a lost inventory update.
      const inventories = await tx.$queryRaw<
        Array<{ id: string; product_id: string; available_quantity: number }>
      >`
        SELECT id, product_id, available_quantity
        FROM inventories
        WHERE product_id = ${item.product_id}::uuid
        FOR UPDATE
      `;
      const inventory = inventories[0];
      if (inventory === undefined) {
        // Unreachable while product creation keeps its atomic
        // product+inventory invariant, but failing closed keeps a missing
        // row from silently skipping the stock update.
        throw receivingNotFoundError();
      }

      const cumulativeReceivedQuantity = item.received_quantity + input.quantity;
      const availableStock = inventory.available_quantity + input.quantity;

      // 7. Record the receipt operation. The row is inserted before the
      // writes it describes so a unique violation aborts before any state
      // change is staged; the snapshot is stored with the built payload.
      // (The `ReceiptResult` body is completed after the status is known —
      // see below — but the row must exist first to win a same-key race.)
      const operation = await tx.receiptOperation.create({
        data: {
          performedBy: input.performedBy,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          receivingItemId: item.id,
          quantity: input.quantity,
          responseSnapshot: {},
        },
      });

      // 8.–10. Item, inventory, and audit writes.
      await tx.receivingItem.update({
        where: { id: item.id },
        data: { receivedQuantity: cumulativeReceivedQuantity },
      });
      await tx.inventory.update({
        where: { id: inventory.id },
        data: { availableQuantity: availableStock },
      });
      await tx.inventoryTransaction.create({
        data: {
          productId: item.product_id,
          receivingItemId: item.id,
          receiptOperationId: operation.id,
          transactionType: "RECEIPT",
          // `quantity_change = receipt_operations.quantity` by construction:
          // the same validated `input.quantity` feeds both rows.
          quantityChange: input.quantity,
          performedBy: input.performedBy,
        },
      });

      // 11. Recalculate status from ALL items read inside this transaction
      // while the document lock is held — never from a pre-lock read.
      const siblings = await tx.receivingItem.findMany({
        where: { documentId: document.id },
        select: { id: true, expectedQuantity: true, receivedQuantity: true },
      });
      const current = siblings.map((sibling) =>
        sibling.id === item.id
          ? {
              expectedQuantity: item.expected_quantity,
              receivedQuantity: cumulativeReceivedQuantity,
            }
          : {
              expectedQuantity: sibling.expectedQuantity,
              receivedQuantity: sibling.receivedQuantity,
            },
      );
      const documentStatus = deriveStatus(current);
      await tx.receivingDocument.update({
        where: { id: document.id },
        data: { status: documentStatus },
      });

      const result: ReceiptResultView = {
        receiptOperationId: operation.id,
        documentNumber: document.document_number,
        itemId: item.id,
        quantityReceivedNow: input.quantity,
        cumulativeReceivedQuantity,
        remainingQuantity: item.expected_quantity - cumulativeReceivedQuantity,
        availableStock,
        documentStatus,
      };

      // 12. Store the response snapshot: the `data` payload only. The replay
      // status is fixed at `200` by rule, so it is not stored. The cast is
      // safe — every field is a JSON scalar — and Prisma offers no narrower
      // input type for a known-shape object.
      await tx.receiptOperation.update({
        where: { id: operation.id },
        data: { responseSnapshot: result as unknown as Prisma.InputJsonValue },
      });

      return { result, replayed: false };
    });
  } catch (error) {
    if (!isUniqueConstraintViolation(error)) {
      throw error;
    }
    // A concurrent request committed the same `(performed_by,
    // idempotency_key)` first. This transaction rolled back; re-read the
    // committed row in a fresh transaction and resolve by the same table:
    // matching hash replays with `200`, anything else is `409`.
    return resolveIdempotencyRace(prisma, input, requestHash, error);
  }
}

/** Resolves a lost same-key race after the P2002 rollback. */
async function resolveIdempotencyRace(
  prisma: PrismaClient,
  input: RecordReceiptInput,
  requestHash: string,
  cause: unknown,
): Promise<RecordReceiptOutcome> {
  const committed = await prisma.receiptOperation.findUnique({
    where: {
      performedBy_idempotencyKey: {
        performedBy: input.performedBy,
        idempotencyKey: input.idempotencyKey,
      },
    },
  });

  if (committed === null) {
    // Unreachable through the receipt path — the only other unique insert
    // in the transaction derives its key from the just-created operation —
    // so a missing row is an unexpected state, not a conflict. Re-raising
    // the original error keeps it a `500`, never a fabricated `409`.
    throw cause;
  }

  if (
    committed !== null &&
    committed.receivingItemId === input.itemId &&
    committed.quantity === input.quantity &&
    committed.requestHash === requestHash
  ) {
    return {
      result: committed.responseSnapshot as unknown as ReceiptResultView,
      replayed: true,
    };
  }

  throw idempotencyKeyConflictError();
}
