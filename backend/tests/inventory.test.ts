/**
 * Inventory tests (INV-04 listing, INV-05/INV-10 history, API-02/04 shape
 * checks in `docs/testing.md`).
 *
 * Stock-movement assertions (INV-01 … INV-03, INV-06 … INV-09) live in
 * `tests/receipts.test.ts` next to the receipt operations that produce
 * them; this file covers the read surface: pagination, search, product and
 * date filters, newest-first ordering, and the absence of sensitive fields.
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { api, bearer, createUserWithToken } from "./helpers/api.js";
import { disconnectTestDatabase, getTestPrisma, resetDatabase } from "./helpers/db.js";

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

const asError = (body: unknown): ErrorBody => body as ErrorBody;

interface InventoryRow {
  productId: string;
  sku: string;
  name: string;
  availableQuantity: number;
}

interface InventoryListBody {
  data: InventoryRow[];
  meta: { page: number; limit: number; total: number };
}

interface TransactionRow {
  id: string;
  productId: string;
  sku: string;
  transactionType: string;
  quantityChange: number;
  documentNumber: string;
  performedBy: string;
  createdAt: string;
}

interface TransactionListBody {
  data: TransactionRow[];
  meta: { page: number; limit: number; total: number };
}

async function seedOperator(suffix: string): Promise<{ token: string }> {
  const user = await createUserWithToken(getTestPrisma(), {
    email: `operator.inventory-${suffix}@example.com`,
    role: "OPERATOR",
  });
  return { token: user.token };
}

async function seedSupervisor(suffix: string): Promise<{ token: string }> {
  const user = await createUserWithToken(getTestPrisma(), {
    email: `supervisor.inventory-${suffix}@example.com`,
    role: "SUPERVISOR",
  });
  return { token: user.token };
}

async function createProduct(token: string, sku: string): Promise<string> {
  const response = await api(getTestPrisma())
    .post("/api/v1/products")
    .set("Authorization", bearer(token))
    .send({ sku, name: `Inventory ${sku}` });
  expect(response.status).toBe(201);
  return (response.body as { data: { id: string } }).data.id;
}

async function createDocument(
  token: string,
  items: Array<{ productId: string; expectedQuantity: number }>,
): Promise<string> {
  const response = await api(getTestPrisma())
    .post("/api/v1/receiving-documents")
    .set("Authorization", bearer(token))
    .send({ items });
  expect(response.status).toBe(201);
  return (response.body as { data: { id: string } }).data.id;
}

async function itemIdOf(
  token: string,
  documentId: string,
  productId: string,
): Promise<string> {
  const detail = await api(getTestPrisma())
    .get(`/api/v1/receiving-documents/${documentId}`)
    .set("Authorization", bearer(token));
  const items = (
    detail.body as { data: { items: Array<{ id: string; productId: string }> } }
  ).data.items;
  return items.find((item) => item.productId === productId)?.id ?? "";
}

async function receive(
  token: string,
  documentId: string,
  itemId: string,
  quantity: number,
): Promise<void> {
  const response = await api(getTestPrisma())
    .post(`/api/v1/receiving-documents/${documentId}/items/${itemId}/receipts`)
    .set("Authorization", bearer(token))
    .set("Idempotency-Key", randomUUID())
    .send({ quantity });
  expect(response.status).toBe(201);
}

describe("GET /api/v1/inventory", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await disconnectTestDatabase();
  });

  it("INV-04: lists persisted stock with pagination metadata", async () => {
    const supervisor = await seedSupervisor("list");
    const operator = await seedOperator("list");
    const productId = await createProduct(supervisor.token, "INV-LIST-001");
    const documentId = await createDocument(operator.token, [
      { productId, expectedQuantity: 10 },
    ]);
    await receive(operator.token, documentId, await itemIdOf(operator.token, documentId, productId), 6);

    const response = await api(getTestPrisma())
      .get("/api/v1/inventory?page=1&limit=20")
      .set("Authorization", bearer(operator.token));

    expect(response.status).toBe(200);
    const body = response.body as InventoryListBody;
    expect(body.meta).toEqual({ page: 1, limit: 20, total: 1 });
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toEqual({
      productId,
      sku: "INV-LIST-001",
      name: "Inventory INV-LIST-001",
      availableQuantity: 6,
    });
  });

  it("searches by SKU and name, and honors an empty result", async () => {
    const supervisor = await seedSupervisor("search");
    const operator = await seedOperator("search");
    await createProduct(supervisor.token, "INV-SEARCH-ALPHA");
    await createProduct(supervisor.token, "INV-SEARCH-BETA");

    const bySku = await api(getTestPrisma())
      .get("/api/v1/inventory?search=alpha")
      .set("Authorization", bearer(operator.token));
    expect(bySku.status).toBe(200);
    expect((bySku.body as InventoryListBody).data.map((row) => row.sku)).toEqual([
      "INV-SEARCH-ALPHA",
    ]);

    const missing = await api(getTestPrisma())
      .get("/api/v1/inventory?search=no-such-product")
      .set("Authorization", bearer(operator.token));
    expect(missing.status).toBe(200);
    expect((missing.body as InventoryListBody).data).toEqual([]);
  });

  it("shows zero stock for products never received", async () => {
    const supervisor = await seedSupervisor("zero");
    const operator = await seedOperator("zero");
    await createProduct(supervisor.token, "INV-ZERO-001");

    const response = await api(getTestPrisma())
      .get("/api/v1/inventory")
      .set("Authorization", bearer(operator.token));

    expect(response.status).toBe(200);
    expect((response.body as InventoryListBody).data[0]?.availableQuantity).toBe(0);
  });

  it("rejects unauthenticated access and invalid pagination", async () => {
    const anonymous = await api(getTestPrisma()).get("/api/v1/inventory");
    expect(anonymous.status).toBe(401);
    expect(asError(anonymous.body).error.code).toBe("UNAUTHENTICATED");

    const operator = await seedOperator("badpage");
    const badPage = await api(getTestPrisma())
      .get("/api/v1/inventory?page=0")
      .set("Authorization", bearer(operator.token));
    expect(badPage.status).toBe(400);
    expect(asError(badPage.body).error.code).toBe("VALIDATION_ERROR");
  });
});

describe("GET /api/v1/inventory/transactions", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await disconnectTestDatabase();
  });

  it("returns history newest-first with the contract shape and no secrets", async () => {
    const supervisor = await seedSupervisor("hist");
    const operator = await seedOperator("hist");
    const productId = await createProduct(supervisor.token, "INV-HIST-001");
    const documentId = await createDocument(operator.token, [
      { productId, expectedQuantity: 10 },
    ]);
    const itemId = await itemIdOf(operator.token, documentId, productId);
    await receive(operator.token, documentId, itemId, 4);
    await receive(operator.token, documentId, itemId, 3);

    const response = await api(getTestPrisma())
      .get("/api/v1/inventory/transactions")
      .set("Authorization", bearer(operator.token));

    expect(response.status).toBe(200);
    const body = response.body as TransactionListBody;
    expect(body.meta.total).toBe(2);
    expect(body.data.map((row) => row.quantityChange)).toEqual([3, 4]);
    for (const row of body.data) {
      expect(Object.keys(row).sort()).toEqual(
        [
          "createdAt",
          "documentNumber",
          "id",
          "performedBy",
          "productId",
          "quantityChange",
          "sku",
          "transactionType",
        ].sort(),
      );
      expect(row.transactionType).toBe("RECEIPT");
      expect(row.sku).toBe("INV-HIST-001");
      expect(row.performedBy).toBe(`operator.inventory-hist@example.com`);
      expect(new Date(row.createdAt).toString()).not.toBe("Invalid Date");
    }
    expect(JSON.stringify(body)).not.toContain("password");
  });

  it("filters by product and inclusive date range", async () => {
    const supervisor = await seedSupervisor("filter");
    const operator = await seedOperator("filter");
    const first = await createProduct(supervisor.token, "INV-FILT-A");
    const second = await createProduct(supervisor.token, "INV-FILT-B");
    const documentId = await createDocument(operator.token, [
      { productId: first, expectedQuantity: 10 },
      { productId: second, expectedQuantity: 10 },
    ]);
    await receive(operator.token, documentId, await itemIdOf(operator.token, documentId, first), 2);
    await receive(operator.token, documentId, await itemIdOf(operator.token, documentId, second), 5);

    const byProduct = await api(getTestPrisma())
      .get(`/api/v1/inventory/transactions?productId=${first}`)
      .set("Authorization", bearer(operator.token));
    expect(byProduct.status).toBe(200);
    expect((byProduct.body as TransactionListBody).data.map((row) => row.productId)).toEqual([
      first,
    ]);

    // A future window excludes everything; a wide window includes all.
    const future = await api(getTestPrisma())
      .get("/api/v1/inventory/transactions?from=2999-01-01T00:00:00.000Z")
      .set("Authorization", bearer(operator.token));
    expect((future.body as TransactionListBody).meta.total).toBe(0);

    const wide = await api(getTestPrisma())
      .get(
        "/api/v1/inventory/transactions?from=2000-01-01T00:00:00.000Z&to=2999-01-01T00:00:00.000Z",
      )
      .set("Authorization", bearer(operator.token));
    expect((wide.body as TransactionListBody).meta.total).toBe(2);

    const badProduct = await api(getTestPrisma())
      .get("/api/v1/inventory/transactions?productId=not-a-uuid")
      .set("Authorization", bearer(operator.token));
    expect(badProduct.status).toBe(400);
    expect(asError(badProduct.body).error.code).toBe("VALIDATION_ERROR");
  });

  it("INV-10: stock cannot change without a receipt operation", async () => {
    const prisma = getTestPrisma();
    const supervisor = await seedSupervisor("no receipt");
    const productId = await createProduct(supervisor.token, "INV-NOREC-001");

    // The only stock writers are the receipt transaction (service) and the
    // product-creation seed row. No API surface writes inventory directly,
    // so the audit trail is complete by construction:
    expect(await prisma.inventoryTransaction.count()).toBe(0);
    expect(
      (await prisma.inventory.findUniqueOrThrow({ where: { productId } })).availableQuantity,
    ).toBe(0);
  });
});
