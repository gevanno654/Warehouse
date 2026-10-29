/**
 * Receipt processing tests (REC-01 … REC-14, IDEM-01 … IDEM-15, INV-01 …
 * INV-10 relevant rows, STAT transitions, CON-01 … CON-06 in
 * `docs/testing.md`).
 *
 * All cases run against the isolated PostgreSQL test database: locking,
 * idempotent replay, unique-violation recovery, rollback, and concurrency
 * behaviour cannot be established with mocks.
 */
import { createHash, randomUUID } from "node:crypto";

import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { api, bearer, createTestApp, createUserWithToken } from "./helpers/api.js";
import { disconnectTestDatabase, getTestPrisma, resetDatabase } from "./helpers/db.js";

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

interface ReceiptResultBody {
  receiptOperationId: string;
  documentNumber: string;
  itemId: string;
  quantityReceivedNow: number;
  cumulativeReceivedQuantity: number;
  remainingQuantity: number;
  availableStock: number;
  documentStatus: string;
}

const asError = (body: unknown): ErrorBody => body as ErrorBody;
const asReceipt = (body: unknown): { data: ReceiptResultBody } =>
  body as { data: ReceiptResultBody };

interface Fixture {
  operator: string;
  operatorId: string;
  documentId: string;
  documentNumber: string;
  itemId: string;
  secondItemId: string;
  productId: string;
  secondProductId: string;
}

/** One document with two items (expected 10 and 6), zero received. */
async function seedFixture(suffix: string): Promise<Fixture> {
  const prisma = getTestPrisma();
  const supervisor = await createUserWithToken(prisma, {
    email: `supervisor.receipts-${suffix}@example.com`,
    role: "SUPERVISOR",
  });
  const operator = await createUserWithToken(prisma, {
    email: `operator.receipts-${suffix}@example.com`,
    role: "OPERATOR",
  });

  const auth = bearer(supervisor.token);
  const first = await api(prisma)
    .post("/api/v1/products")
    .set("Authorization", auth)
    .send({ sku: `RCPT-${suffix}-A`, name: `Receipt product A ${suffix}` });
  const second = await api(prisma)
    .post("/api/v1/products")
    .set("Authorization", auth)
    .send({ sku: `RCPT-${suffix}-B`, name: `Receipt product B ${suffix}` });
  const productId = (first.body as { data: { id: string } }).data.id;
  const secondProductId = (second.body as { data: { id: string } }).data.id;

  const created = await api(prisma)
    .post("/api/v1/receiving-documents")
    .set("Authorization", bearer(operator.token))
    .send({
      items: [
        { productId, expectedQuantity: 10 },
        { productId: secondProductId, expectedQuantity: 6 },
      ],
    });
  expect(created.status).toBe(201);
  const document = (created.body as { data: { id: string; documentNumber: string } }).data;

  const detail = await api(prisma)
    .get(`/api/v1/receiving-documents/${document.id}`)
    .set("Authorization", bearer(operator.token));
  const items = (
    detail.body as { data: { items: Array<{ id: string; productId: string }> } }
  ).data.items;
  const itemId = items.find((item) => item.productId === productId)?.id ?? "";
  const secondItemId = items.find((item) => item.productId === secondProductId)?.id ?? "";

  return {
    operator: operator.token,
    operatorId: operator.id,
    documentId: document.id,
    documentNumber: document.documentNumber,
    itemId,
    secondItemId,
    productId,
    secondProductId,
  };
}

describe("POST receipts — happy path and validation", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await disconnectTestDatabase();
  });

  it("REC-01: partial receipt returns 201 and PARTIALLY_RECEIVED", async () => {
    const fixture = await seedFixture("rec01");

    const response = await api(getTestPrisma())
      .post(`/api/v1/receiving-documents/${fixture.documentId}/items/${fixture.itemId}/receipts`)
      .set("Authorization", bearer(fixture.operator))
      .set("Idempotency-Key", randomUUID())
      .send({ quantity: 4 });

    expect(response.status).toBe(201);
    const result = asReceipt(response.body).data;
    expect(result).toMatchObject({
      documentNumber: fixture.documentNumber,
      itemId: fixture.itemId,
      quantityReceivedNow: 4,
      cumulativeReceivedQuantity: 4,
      remainingQuantity: 6,
      availableStock: 4,
      documentStatus: "PARTIALLY_RECEIVED",
    });

    const prisma = getTestPrisma();
    expect(
      (await prisma.receivingItem.findUniqueOrThrow({ where: { id: fixture.itemId } }))
        .receivedQuantity,
    ).toBe(4);
    expect(
      (await prisma.inventory.findUniqueOrThrow({ where: { productId: fixture.productId } }))
        .availableQuantity,
    ).toBe(4);
  });

  it("REC-02/03/10: receiving the remainder completes the item", async () => {
    const fixture = await seedFixture("rec02");
    const prisma = getTestPrisma();
    const url = `/api/v1/receiving-documents/${fixture.documentId}/items/${fixture.itemId}/receipts`;

    const partial = await api(prisma)
      .post(url)
      .set("Authorization", bearer(fixture.operator))
      .set("Idempotency-Key", randomUUID())
      .send({ quantity: 4 });
    expect(partial.status).toBe(201);

    const rest = await api(prisma)
      .post(url)
      .set("Authorization", bearer(fixture.operator))
      .set("Idempotency-Key", randomUUID())
      .send({ quantity: 6 });
    expect(rest.status).toBe(201);
    const result = asReceipt(rest.body).data;
    expect(result.cumulativeReceivedQuantity).toBe(10);
    expect(result.remainingQuantity).toBe(0);
    expect(result.availableStock).toBe(10);
    // The sibling item is untouched, so the document stays partial (REC-14).
    expect(result.documentStatus).toBe("PARTIALLY_RECEIVED");
  });

  it.each([
    ["REC-04 zero", 0],
    ["REC-05 negative", -2],
    ["REC-06 fractional", 1.5],
  ])("%s quantity returns 400 INVALID_QUANTITY with no writes", async (_label, quantity) => {
    const fixture = await seedFixture(`recinv-${String(quantity).replace(/[^a-z0-9]/gi, "")}`);
    const prisma = getTestPrisma();

    const response = await api(prisma)
      .post(`/api/v1/receiving-documents/${fixture.documentId}/items/${fixture.itemId}/receipts`)
      .set("Authorization", bearer(fixture.operator))
      .set("Idempotency-Key", randomUUID())
      .send({ quantity });

    expect(response.status).toBe(400);
    expect(asError(response.body).error.code).toBe("INVALID_QUANTITY");
    expect(await prisma.receiptOperation.count()).toBe(0);
    expect(await prisma.inventoryTransaction.count()).toBe(0);
    expect(
      (await prisma.receivingItem.findUniqueOrThrow({ where: { id: fixture.itemId } }))
        .receivedQuantity,
    ).toBe(0);
  });

  it("REC-07: over-receiving returns 422 with remainingQuantity and no writes", async () => {
    const fixture = await seedFixture("rec07");
    const prisma = getTestPrisma();

    const first = await api(prisma)
      .post(`/api/v1/receiving-documents/${fixture.documentId}/items/${fixture.itemId}/receipts`)
      .set("Authorization", bearer(fixture.operator))
      .set("Idempotency-Key", randomUUID())
      .send({ quantity: 4 });
    expect(first.status).toBe(201);

    const response = await api(prisma)
      .post(`/api/v1/receiving-documents/${fixture.documentId}/items/${fixture.itemId}/receipts`)
      .set("Authorization", bearer(fixture.operator))
      .set("Idempotency-Key", randomUUID())
      .send({ quantity: 7 });

    expect(response.status).toBe(422);
    const error = asError(response.body).error;
    expect(error.code).toBe("RECEIPT_EXCEEDS_REMAINING");
    expect(error.details?.["remainingQuantity"]).toBe(6);
    expect(await prisma.receiptOperation.count()).toBe(1);
    expect(
      (await prisma.inventory.findUniqueOrThrow({ where: { productId: fixture.productId } }))
        .availableQuantity,
    ).toBe(4);
  });

  it("REC-08: unknown document or item returns 404", async () => {
    const fixture = await seedFixture("rec08");
    const prisma = getTestPrisma();
    const missing = "00000000-0000-4000-8000-000000000000";

    const unknownDocument = await api(prisma)
      .post(`/api/v1/receiving-documents/${missing}/items/${fixture.itemId}/receipts`)
      .set("Authorization", bearer(fixture.operator))
      .set("Idempotency-Key", randomUUID())
      .send({ quantity: 1 });
    expect(unknownDocument.status).toBe(404);

    const unknownItem = await api(prisma)
      .post(`/api/v1/receiving-documents/${fixture.documentId}/items/${missing}/receipts`)
      .set("Authorization", bearer(fixture.operator))
      .set("Idempotency-Key", randomUUID())
      .send({ quantity: 1 });
    expect(unknownItem.status).toBe(404);
    expect(asError(unknownItem.body).error.code).toBe("NOT_FOUND");
  });

  it("REC-11: an item of another document is 404, not cross-resolved", async () => {
    const prisma = getTestPrisma();
    const first = await seedFixture("rec11a");
    const second = await seedFixture("rec11b");

    const response = await api(prisma)
      .post(`/api/v1/receiving-documents/${first.documentId}/items/${second.itemId}/receipts`)
      .set("Authorization", bearer(first.operator))
      .set("Idempotency-Key", randomUUID())
      .send({ quantity: 1 });

    expect(response.status).toBe(404);
    expect(asError(response.body).error.code).toBe("NOT_FOUND");
    expect(await prisma.receiptOperation.count()).toBe(0);
  });

  it("REC-09: missing Idempotency-Key returns 400 IDEMPOTENCY_KEY_REQUIRED", async () => {
    const fixture = await seedFixture("rec09");

    const response = await api(getTestPrisma())
      .post(`/api/v1/receiving-documents/${fixture.documentId}/items/${fixture.itemId}/receipts`)
      .set("Authorization", bearer(fixture.operator))
      .send({ quantity: 1 });

    expect(response.status).toBe(400);
    expect(asError(response.body).error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
  });

  it("REC-12: malformed IDs and body return 400", async () => {
    const fixture = await seedFixture("rec12");
    const prisma = getTestPrisma();

    const badDocument = await api(prisma)
      .post(`/api/v1/receiving-documents/nope/items/${fixture.itemId}/receipts`)
      .set("Authorization", bearer(fixture.operator))
      .set("Idempotency-Key", randomUUID())
      .send({ quantity: 1 });
    expect(badDocument.status).toBe(400);

    const badItem = await api(prisma)
      .post(`/api/v1/receiving-documents/${fixture.documentId}/items/nope/receipts`)
      .set("Authorization", bearer(fixture.operator))
      .set("Idempotency-Key", randomUUID())
      .send({ quantity: 1 });
    expect(badItem.status).toBe(400);
    expect(asError(badItem.body).error.code).toBe("VALIDATION_ERROR");

    const badBody = await api(prisma)
      .post(`/api/v1/receiving-documents/${fixture.documentId}/items/${fixture.itemId}/receipts`)
      .set("Authorization", bearer(fixture.operator))
      .set("Idempotency-Key", randomUUID())
      .send({});
    expect(badBody.status).toBe(400);
  });

  it("REC-13: a fresh key against a COMPLETED document returns 422", async () => {
    const fixture = await seedFixture("rec13");
    const prisma = getTestPrisma();
    const firstUrl = `/api/v1/receiving-documents/${fixture.documentId}/items/${fixture.itemId}/receipts`;
    const secondUrl = `/api/v1/receiving-documents/${fixture.documentId}/items/${fixture.secondItemId}/receipts`;

    const first = await api(prisma)
      .post(firstUrl)
      .set("Authorization", bearer(fixture.operator))
      .set("Idempotency-Key", randomUUID())
      .send({ quantity: 10 });
    expect(first.status).toBe(201);
    const second = await api(prisma)
      .post(secondUrl)
      .set("Authorization", bearer(fixture.operator))
      .set("Idempotency-Key", randomUUID())
      .send({ quantity: 6 });
    expect(second.status).toBe(201);
    expect(asReceipt(second.body).data.documentStatus).toBe("COMPLETED");

    const rejected = await api(prisma)
      .post(firstUrl)
      .set("Authorization", bearer(fixture.operator))
      .set("Idempotency-Key", randomUUID())
      .send({ quantity: 1 });
    expect(rejected.status).toBe(422);
    expect(asError(rejected.body).error.code).toBe("DOCUMENT_ALREADY_COMPLETED");
  });

  it("requires authentication and authorises both roles", async () => {
    const fixture = await seedFixture("rec-auth");
    const prisma = getTestPrisma();
    const url = `/api/v1/receiving-documents/${fixture.documentId}/items/${fixture.itemId}/receipts`;

    const anonymous = await api(prisma)
      .post(url)
      .set("Idempotency-Key", randomUUID())
      .send({ quantity: 1 });
    expect(anonymous.status).toBe(401);

    const badToken = await api(prisma)
      .post(url)
      .set("Authorization", "Bearer not-a-token")
      .set("Idempotency-Key", randomUUID())
      .send({ quantity: 1 });
    expect(badToken.status).toBe(401);
  });
});

describe("POST receipts — idempotency", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await disconnectTestDatabase();
  });

  it("IDEM-01/02/07: same key and payload replays 200 with identical body", async () => {
    const fixture = await seedFixture("idem0102");
    const prisma = getTestPrisma();
    const url = `/api/v1/receiving-documents/${fixture.documentId}/items/${fixture.itemId}/receipts`;
    const key = randomUUID();

    const first = await api(prisma)
      .post(url)
      .set("Authorization", bearer(fixture.operator))
      .set("Idempotency-Key", key)
      .send({ quantity: 4 });
    expect(first.status).toBe(201);
    const firstBody = asReceipt(first.body).data;

    const replay = await api(prisma)
      .post(url)
      .set("Authorization", bearer(fixture.operator))
      .set("Idempotency-Key", key)
      .send({ quantity: 4 });
    expect(replay.status).toBe(200);
    expect(asReceipt(replay.body).data).toEqual(firstBody);

    // No second operation, no second transaction, no extra stock.
    expect(await prisma.receiptOperation.count()).toBe(1);
    expect(await prisma.inventoryTransaction.count()).toBe(1);
    expect(
      (await prisma.inventory.findUniqueOrThrow({ where: { productId: fixture.productId } }))
        .availableQuantity,
    ).toBe(4);

    // The stored snapshot matches the committed response body.
    const stored = await prisma.receiptOperation.findFirstOrThrow();
    expect(stored.responseSnapshot).toEqual(firstBody);
    expect(stored.requestHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.receivingItemId).toBe(fixture.itemId);
  });

  it("IDEM-03: same key with a different quantity returns 409", async () => {
    const fixture = await seedFixture("idem03");
    const prisma = getTestPrisma();
    const url = `/api/v1/receiving-documents/${fixture.documentId}/items/${fixture.itemId}/receipts`;
    const key = randomUUID();

    const first = await api(prisma)
      .post(url)
      .set("Authorization", bearer(fixture.operator))
      .set("Idempotency-Key", key)
      .send({ quantity: 4 });
    expect(first.status).toBe(201);

    const conflict = await api(prisma)
      .post(url)
      .set("Authorization", bearer(fixture.operator))
      .set("Idempotency-Key", key)
      .send({ quantity: 5 });
    expect(conflict.status).toBe(409);
    expect(asError(conflict.body).error.code).toBe("IDEMPOTENCY_KEY_CONFLICT");
    expect(await prisma.receiptOperation.count()).toBe(1);
  });

  it.each([
    ["IDEM-08 different item", "item"],
    ["IDEM-09 different document", "document"],
  ])("%s with the same quantity returns 409", async (_label, variant) => {
    const fixture = await seedFixture(`idem08-${variant}`);
    const prisma = getTestPrisma();
    const key = randomUUID();

    const first = await api(prisma)
      .post(`/api/v1/receiving-documents/${fixture.documentId}/items/${fixture.itemId}/receipts`)
      .set("Authorization", bearer(fixture.operator))
      .set("Idempotency-Key", key)
      .send({ quantity: 2 });
    expect(first.status).toBe(201);

    let second;
    if (variant === "item") {
      second = await api(prisma)
        .post(
          `/api/v1/receiving-documents/${fixture.documentId}/items/${fixture.secondItemId}/receipts`,
        )
        .set("Authorization", bearer(fixture.operator))
        .set("Idempotency-Key", key)
        .send({ quantity: 2 });
    } else {
      const other = await seedFixture(`idem09-other`);
      second = await api(prisma)
        .post(`/api/v1/receiving-documents/${other.documentId}/items/${other.itemId}/receipts`)
        .set("Authorization", bearer(fixture.operator))
        .set("Idempotency-Key", key)
        .send({ quantity: 2 });
    }
    expect(second.status).toBe(409);
    expect(asError(second.body).error.code).toBe("IDEMPOTENCY_KEY_CONFLICT");
  });

  it("IDEM-10: replay after COMPLETED still returns 200", async () => {
    const fixture = await seedFixture("idem10");
    const prisma = getTestPrisma();
    const firstUrl = `/api/v1/receiving-documents/${fixture.documentId}/items/${fixture.itemId}/receipts`;
    const secondUrl = `/api/v1/receiving-documents/${fixture.documentId}/items/${fixture.secondItemId}/receipts`;
    const key = randomUUID();

    const first = await api(prisma)
      .post(firstUrl)
      .set("Authorization", bearer(fixture.operator))
      .set("Idempotency-Key", key)
      .send({ quantity: 10 });
    expect(first.status).toBe(201);
    const stored = asReceipt(first.body).data;

    const complete = await api(prisma)
      .post(secondUrl)
      .set("Authorization", bearer(fixture.operator))
      .set("Idempotency-Key", randomUUID())
      .send({ quantity: 6 });
    expect(asReceipt(complete.body).data.documentStatus).toBe("COMPLETED");

    const replay = await api(prisma)
      .post(firstUrl)
      .set("Authorization", bearer(fixture.operator))
      .set("Idempotency-Key", key)
      .send({ quantity: 10 });
    expect(replay.status).toBe(200);
    expect(asReceipt(replay.body).data).toEqual(stored);
    expect(await prisma.receiptOperation.count()).toBe(2);
  });

  it("IDEM-11/12: the same key value is scoped per user", async () => {
    const prisma = getTestPrisma();
    const first = await seedFixture("idem11a");
    const secondOperator = await createUserWithToken(prisma, {
      email: "operator.idem11b@example.com",
      role: "OPERATOR",
    });
    const key = randomUUID();
    const url = (documentId: string, itemId: string): string =>
      `/api/v1/receiving-documents/${documentId}/items/${itemId}/receipts`;

    const firstResponse = await api(prisma)
      .post(url(first.documentId, first.itemId))
      .set("Authorization", bearer(first.operator))
      .set("Idempotency-Key", key)
      .send({ quantity: 3 });
    expect(firstResponse.status).toBe(201);

    // Same key, different user, different payload: independent success.
    const second = await seedFixture("idem11b");
    const secondResponse = await api(prisma)
      .post(url(second.documentId, second.itemId))
      .set("Authorization", bearer(secondOperator.token))
      .set("Idempotency-Key", key)
      .send({ quantity: 5 });
    expect(secondResponse.status).toBe(201);

    expect(await prisma.receiptOperation.count()).toBe(2);
  });

  it("IDEM-15: request_hash is sha256(post|documentId|itemId|quantity)", async () => {
    const fixture = await seedFixture("idem15");
    const prisma = getTestPrisma();

    const response = await api(prisma)
      .post(`/api/v1/receiving-documents/${fixture.documentId}/items/${fixture.itemId}/receipts`)
      .set("Authorization", bearer(fixture.operator))
      .set("Idempotency-Key", randomUUID())
      .send({ quantity: 4 });
    expect(response.status).toBe(201);

    const expected = createHash("sha256")
      .update(`post|${fixture.documentId}|${fixture.itemId}|4`, "utf8")
      .digest("hex");
    const stored = await prisma.receiptOperation.findFirstOrThrow();
    expect(stored.requestHash).toBe(expected);
  });
});

describe("POST receipts — inventory consistency and status", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await disconnectTestDatabase();
  });

  it("INV-01/02/08: inventory equals the sum of accepted quantities", async () => {
    const fixture = await seedFixture("inv0102");
    const prisma = getTestPrisma();
    const url = `/api/v1/receiving-documents/${fixture.documentId}/items/${fixture.itemId}/receipts`;

    await api(prisma)
      .post(url)
      .set("Authorization", bearer(fixture.operator))
      .set("Idempotency-Key", randomUUID())
      .send({ quantity: 4 });
    await api(prisma)
      .post(url)
      .set("Authorization", bearer(fixture.operator))
      .set("Idempotency-Key", randomUUID())
      .send({ quantity: 3 });

    const inventory = await prisma.inventory.findUniqueOrThrow({
      where: { productId: fixture.productId },
    });
    expect(inventory.availableQuantity).toBe(7);

    const sum = await prisma.inventoryTransaction.aggregate({
      where: { productId: fixture.productId },
      _sum: { quantityChange: true },
    });
    expect(sum._sum.quantityChange).toBe(7);
  });

  it("INV-05/09: one receipt produces one RECEIPT transaction linked to the operation", async () => {
    const fixture = await seedFixture("inv0509");
    const prisma = getTestPrisma();

    const response = await api(prisma)
      .post(`/api/v1/receiving-documents/${fixture.documentId}/items/${fixture.itemId}/receipts`)
      .set("Authorization", bearer(fixture.operator))
      .set("Idempotency-Key", randomUUID())
      .send({ quantity: 4 });
    expect(response.status).toBe(201);
    const operationId = asReceipt(response.body).data.receiptOperationId;

    const transactions = await prisma.inventoryTransaction.findMany({
      where: { productId: fixture.productId },
    });
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({
      receiptOperationId: operationId,
      transactionType: "RECEIPT",
      quantityChange: 4,
      receivingItemId: fixture.itemId,
      performedBy: fixture.operatorId,
    });

    const history = await api(prisma)
      .get(`/api/v1/inventory/transactions?productId=${fixture.productId}`)
      .set("Authorization", bearer(fixture.operator));
    expect(history.status).toBe(200);
    const rows = (history.body as { data: Array<Record<string, unknown>> }).data;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      productId: fixture.productId,
      transactionType: "RECEIPT",
      quantityChange: 4,
      documentNumber: fixture.documentNumber,
    });
  });

  it("CON-04/T-14: a mid-transaction database failure rolls everything back", async () => {
    const prisma = getTestPrisma();
    const supervisor = await createUserWithToken(prisma, {
      email: "supervisor.rollback@example.com",
      role: "SUPERVISOR",
    });
    const product = await api(prisma)
      .post("/api/v1/products")
      .set("Authorization", bearer(supervisor.token))
      .send({ sku: "ROLLBACK-001", name: "Rollback product" });
    const productId = (product.body as { data: { id: string } }).data.id;
    const created = await api(prisma)
      .post("/api/v1/receiving-documents")
      .set("Authorization", bearer(supervisor.token))
      .send({ items: [{ productId, expectedQuantity: 1000 }] });
    const documentId = (created.body as { data: { id: string } }).data.id;
    const detail = await api(prisma)
      .get(`/api/v1/receiving-documents/${documentId}`)
      .set("Authorization", bearer(supervisor.token));
    const itemId = (
      detail.body as { data: { items: Array<{ id: string }> } }
    ).data.items[0]?.id as string;

    // Database-level fault injection: fail the inventory-transaction insert
    // AFTER the receipt operation, item, and inventory writes are staged in
    // the same transaction. The service cannot catch this; the whole
    // transaction must roll back.
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION reject_receipt_audit() RETURNS trigger AS $func$
      BEGIN
        RAISE EXCEPTION 'injected audit failure';
      END;
      $func$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS reject_receipt_audit_trigger ON inventory_transactions`,
    );
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER reject_receipt_audit_trigger
        BEFORE INSERT ON inventory_transactions
        FOR EACH ROW EXECUTE FUNCTION reject_receipt_audit()
    `);

    try {
      const response = await api(prisma)
        .post(`/api/v1/receiving-documents/${documentId}/items/${itemId}/receipts`)
        .set("Authorization", bearer(supervisor.token))
        .set("Idempotency-Key", randomUUID())
        .send({ quantity: 100 });

      // 500: the failure is unexpected, not a business-rule violation.
      expect(response.status).toBe(500);
      expect(asError(response.body).error.code).toBe("INTERNAL_ERROR");

      // Production mode strips the dev breadcrumb entirely (API-11): the
      // client sees the generic message and code, never SQL, paths, or
      // trigger internals.
      const prodResponse = await request(createTestApp(prisma, { isProduction: true }))
        .post(`/api/v1/receiving-documents/${documentId}/items/${itemId}/receipts`)
        .set("Authorization", bearer(supervisor.token))
        .set("Idempotency-Key", randomUUID())
        .send({ quantity: 100 });
      expect(prodResponse.status).toBe(500);
      expect(prodResponse.body).toEqual({
        error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." },
      });

      // Nothing from the failed operation survives: no operation row (so a
      // retry with the same key is a first-time request, IDEM-14), no
      // transaction, no item change, no stock change, status untouched.
      expect(await prisma.receiptOperation.count()).toBe(0);
      expect(await prisma.inventoryTransaction.count()).toBe(0);
      expect(
        (await prisma.receivingItem.findUniqueOrThrow({ where: { id: itemId } }))
          .receivedQuantity,
      ).toBe(0);
      expect(
        (await prisma.inventory.findUniqueOrThrow({ where: { productId } })).availableQuantity,
      ).toBe(0);
      expect(
        (await prisma.receivingDocument.findUniqueOrThrow({ where: { id: documentId } })).status,
      ).toBe("PENDING");

    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS reject_receipt_audit_trigger ON inventory_transactions`,
      );
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS reject_receipt_audit()`);
    }
  });

  it("INV-06: a rejected receipt leaves no operation, transaction, or stock change", async () => {
    const fixture = await seedFixture("inv06");
    const prisma = getTestPrisma();

    const response = await api(prisma)
      .post(`/api/v1/receiving-documents/${fixture.documentId}/items/${fixture.itemId}/receipts`)
      .set("Authorization", bearer(fixture.operator))
      .set("Idempotency-Key", randomUUID())
      .send({ quantity: 99 });

    expect(response.status).toBe(422);
    expect(await prisma.receiptOperation.count()).toBe(0);
    expect(await prisma.inventoryTransaction.count()).toBe(0);
    expect(
      (await prisma.inventory.findUniqueOrThrow({ where: { productId: fixture.productId } }))
        .availableQuantity,
    ).toBe(0);
    expect(
      (await prisma.receivingItem.findUniqueOrThrow({ where: { id: fixture.itemId } }))
        .receivedQuantity,
    ).toBe(0);
  });

  it("STAT: status follows PENDING → PARTIALLY_RECEIVED → COMPLETED", async () => {
    const fixture = await seedFixture("statflow");
    const prisma = getTestPrisma();
    const firstUrl = `/api/v1/receiving-documents/${fixture.documentId}/items/${fixture.itemId}/receipts`;
    const secondUrl = `/api/v1/receiving-documents/${fixture.documentId}/items/${fixture.secondItemId}/receipts`;
    const getStatus = async (): Promise<string> => {
      const detail = await api(prisma)
        .get(`/api/v1/receiving-documents/${fixture.documentId}`)
        .set("Authorization", bearer(fixture.operator));
      return (detail.body as { data: { status: string } }).data.status;
    };

    expect(await getStatus()).toBe("PENDING");

    const partial = await api(prisma)
      .post(firstUrl)
      .set("Authorization", bearer(fixture.operator))
      .set("Idempotency-Key", randomUUID())
      .send({ quantity: 4 });
    expect(asReceipt(partial.body).data.documentStatus).toBe("PARTIALLY_RECEIVED");
    expect(await getStatus()).toBe("PARTIALLY_RECEIVED");

    const full = await api(prisma)
      .post(firstUrl)
      .set("Authorization", bearer(fixture.operator))
      .set("Idempotency-Key", randomUUID())
      .send({ quantity: 6 });
    // Sibling still pending: recalculated from all items (STAT-07).
    expect(asReceipt(full.body).data.documentStatus).toBe("PARTIALLY_RECEIVED");

    const last = await api(prisma)
      .post(secondUrl)
      .set("Authorization", bearer(fixture.operator))
      .set("Idempotency-Key", randomUUID())
      .send({ quantity: 6 });
    expect(asReceipt(last.body).data.documentStatus).toBe("COMPLETED");
    expect(await getStatus()).toBe("COMPLETED");
  });
});

describe("POST receipts — concurrency", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await disconnectTestDatabase();
  });

  it("CON-01: concurrent over-receiving never exceeds the expected quantity", async () => {
    const fixture = await seedFixture("con01");
    const prisma = getTestPrisma();
    const url = `/api/v1/receiving-documents/${fixture.documentId}/items/${fixture.itemId}/receipts`;

    const [first, second] = await Promise.all([
      api(prisma)
        .post(url)
        .set("Authorization", bearer(fixture.operator))
        .set("Idempotency-Key", randomUUID())
        .send({ quantity: 7 }),
      api(prisma)
        .post(url)
        .set("Authorization", bearer(fixture.operator))
        .set("Idempotency-Key", randomUUID())
        .send({ quantity: 7 }),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 422]);

    const item = await prisma.receivingItem.findUniqueOrThrow({
      where: { id: fixture.itemId },
    });
    expect(item.receivedQuantity).toBe(7);
    const inventory = await prisma.inventory.findUniqueOrThrow({
      where: { productId: fixture.productId },
    });
    expect(inventory.availableQuantity).toBe(7);
    expect(await prisma.inventoryTransaction.count()).toBe(1);
  });

  it("CON-02: concurrent distinct receipts both succeed without lost updates", async () => {
    const fixture = await seedFixture("con02");
    const prisma = getTestPrisma();
    const url = `/api/v1/receiving-documents/${fixture.documentId}/items/${fixture.itemId}/receipts`;

    const [first, second] = await Promise.all([
      api(prisma)
        .post(url)
        .set("Authorization", bearer(fixture.operator))
        .set("Idempotency-Key", randomUUID())
        .send({ quantity: 4 }),
      api(prisma)
        .post(url)
        .set("Authorization", bearer(fixture.operator))
        .set("Idempotency-Key", randomUUID())
        .send({ quantity: 4 }),
    ]);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(
      (await prisma.receivingItem.findUniqueOrThrow({ where: { id: fixture.itemId } }))
        .receivedQuantity,
    ).toBe(8);
    expect(
      (await prisma.inventory.findUniqueOrThrow({ where: { productId: fixture.productId } }))
        .availableQuantity,
    ).toBe(8);
    expect(await prisma.receiptOperation.count()).toBe(2);
    expect(await prisma.inventoryTransaction.count()).toBe(2);
  });

  it("CON-03/IDEM-05: same key raced concurrently applies once", async () => {
    const fixture = await seedFixture("con03");
    const prisma = getTestPrisma();
    const url = `/api/v1/receiving-documents/${fixture.documentId}/items/${fixture.itemId}/receipts`;
    const key = randomUUID();
    const attempt = () =>
      api(prisma)
        .post(url)
        .set("Authorization", bearer(fixture.operator))
        .set("Idempotency-Key", key)
        .send({ quantity: 3 });

    const [first, second] = await Promise.all([attempt(), attempt()]);
    const statuses = [first.status, second.status].sort();
    // Either the loser reads the committed row (200/200) or recovers from
    // the unique violation (201/200) — never a duplicate, never a 500.
    expect([
      [200, 200],
      [200, 201],
    ]).toContainEqual(statuses);

    expect(
      (await prisma.inventory.findUniqueOrThrow({ where: { productId: fixture.productId } }))
        .availableQuantity,
    ).toBe(3);
    expect(await prisma.receiptOperation.count()).toBe(1);
    expect(await prisma.inventoryTransaction.count()).toBe(1);
  });

  it("IDEM-06: same key with different quantities raced — one wins, other 409s", async () => {
    const fixture = await seedFixture("idem06");
    const prisma = getTestPrisma();
    const url = `/api/v1/receiving-documents/${fixture.documentId}/items/${fixture.itemId}/receipts`;
    const key = randomUUID();

    const [first, second] = await Promise.all([
      api(prisma)
        .post(url)
        .set("Authorization", bearer(fixture.operator))
        .set("Idempotency-Key", key)
        .send({ quantity: 2 }),
      api(prisma)
        .post(url)
        .set("Authorization", bearer(fixture.operator))
        .set("Idempotency-Key", key)
        .send({ quantity: 3 }),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);
    expect(await prisma.receiptOperation.count()).toBe(1);
    const inventory = await prisma.inventory.findUniqueOrThrow({
      where: { productId: fixture.productId },
    });
    expect([2, 3]).toContain(inventory.availableQuantity);
  });

  it("CON-05: same product in two documents receives concurrently without loss", async () => {
    const prisma = getTestPrisma();
    const supervisor = await createUserWithToken(prisma, {
      email: "supervisor.con05@example.com",
      role: "SUPERVISOR",
    });
    const operator = await createUserWithToken(prisma, {
      email: "operator.con05@example.com",
      role: "OPERATOR",
    });
    const product = await api(prisma)
      .post("/api/v1/products")
      .set("Authorization", bearer(supervisor.token))
      .send({ sku: "CON05-SHARED", name: "Shared product" });
    const productId = (product.body as { data: { id: string } }).data.id;

    const makeDocument = async (): Promise<{ documentId: string; itemId: string }> => {
      const created = await api(prisma)
        .post("/api/v1/receiving-documents")
        .set("Authorization", bearer(operator.token))
        .send({ items: [{ productId, expectedQuantity: 10 }] });
      const document = (created.body as { data: { id: string } }).data;
      const detail = await api(prisma)
        .get(`/api/v1/receiving-documents/${document.id}`)
        .set("Authorization", bearer(operator.token));
      const items = (detail.body as { data: { items: Array<{ id: string }> } }).data.items;
      return { documentId: document.id, itemId: items[0]?.id ?? "" };
    };

    const first = await makeDocument();
    const second = await makeDocument();

    const [firstResponse, secondResponse] = await Promise.all([
      api(prisma)
        .post(`/api/v1/receiving-documents/${first.documentId}/items/${first.itemId}/receipts`)
        .set("Authorization", bearer(operator.token))
        .set("Idempotency-Key", randomUUID())
        .send({ quantity: 6 }),
      api(prisma)
        .post(`/api/v1/receiving-documents/${second.documentId}/items/${second.itemId}/receipts`)
        .set("Authorization", bearer(operator.token))
        .set("Idempotency-Key", randomUUID())
        .send({ quantity: 6 }),
    ]);

    // Only the inventory row serialises these two; document/item locks do
    // not overlap. Both must succeed and the stock must be the exact sum.
    expect(firstResponse.status).toBe(201);
    expect(secondResponse.status).toBe(201);
    expect(
      (await prisma.inventory.findUniqueOrThrow({ where: { productId } })).availableQuantity,
    ).toBe(12);
  });
});
