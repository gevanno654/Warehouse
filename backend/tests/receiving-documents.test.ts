/**
 * Receiving document tests (DOC-01 … DOC-14, STAT-01 … STAT-05 shapes in
 * `docs/testing.md`).
 *
 * Documents are created through the HTTP surface with supervisor-created
 * products, so every assertion exercises routing, middleware, validation,
 * and persistence together. The isolated test database is truncated between
 * cases (`fileParallelism: false` in `vitest.config.ts`).
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { api, bearer, createUserWithToken } from "./helpers/api.js";
import { disconnectTestDatabase, getTestPrisma, resetDatabase } from "./helpers/db.js";

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

interface ReceivingItemBody {
  id: string;
  productId: string;
  sku: string;
  productName: string;
  expectedQuantity: number;
  receivedQuantity: number;
  remainingQuantity: number;
}

interface ReceivingDocumentBody {
  id: string;
  documentNumber: string;
  status: string;
  createdAt: string;
  updatedAt?: string;
  totalItems: number;
  totalExpectedQuantity: number;
  totalReceivedQuantity: number;
  createdBy?: { id: string; email: string; role: string };
  items: ReceivingItemBody[];
}

interface DocumentResponse {
  data: ReceivingDocumentBody;
}

interface DocumentListResponse {
  data: ReceivingDocumentBody[];
  meta: { page: number; limit: number; total: number };
}

const asError = (body: unknown): ErrorBody => body as ErrorBody;
const asDocument = (body: unknown): DocumentResponse => body as DocumentResponse;
const asList = (body: unknown): DocumentListResponse => body as DocumentListResponse;

async function operatorToken(): Promise<string> {
  const user = await createUserWithToken(getTestPrisma(), {
    email: "operator.receiving@example.com",
    role: "OPERATOR",
  });
  return user.token;
}

async function supervisorToken(): Promise<string> {
  const user = await createUserWithToken(getTestPrisma(), {
    email: "supervisor.receiving@example.com",
    role: "SUPERVISOR",
  });
  return user.token;
}

async function createProduct(token: string, sku: string): Promise<string> {
  const response = await api(getTestPrisma())
    .post("/api/v1/products")
    .set("Authorization", bearer(token))
    .send({ sku, name: `Product ${sku}` });

  expect(response.status).toBe(201);
  return (response.body as { data: { id: string } }).data.id;
}

/** Creates two products and returns their IDs. */
async function seedProducts(): Promise<{ supervisor: string; ids: [string, string] }> {
  const supervisor = await supervisorToken();
  const first = await createProduct(supervisor, "DOC-A-001");
  const second = await createProduct(supervisor, "DOC-A-002");
  return { supervisor, ids: [first, second] };
}

describe("POST /api/v1/receiving-documents", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await disconnectTestDatabase();
  });

  it("DOC-01: creates a document with PENDING status and a generated number", async () => {
    const { ids } = await seedProducts();
    const operator = await operatorToken();

    const response = await api(getTestPrisma())
      .post("/api/v1/receiving-documents")
      .set("Authorization", bearer(operator))
      .send({
        items: [
          { productId: ids[0], expectedQuantity: 100 },
          { productId: ids[1], expectedQuantity: 50 },
        ],
      });

    expect(response.status).toBe(201);
    const document = asDocument(response.body).data;
    expect(document.status).toBe("PENDING");
    expect(document.documentNumber).toMatch(/^RCV-\d{8}-\d{6}$/);
    expect(document.totalItems).toBe(2);
    expect(document.totalExpectedQuantity).toBe(150);
    expect(document.totalReceivedQuantity).toBe(0);
    expect(document.createdBy?.email).toBe("operator.receiving@example.com");
    expect(document.items).toHaveLength(2);
    for (const item of document.items) {
      expect(item.receivedQuantity).toBe(0);
      expect(item.remainingQuantity).toBe(item.expectedQuantity);
    }
  });

  it("DOC-02: rejects an empty item list with 400", async () => {
    const operator = await operatorToken();

    const response = await api(getTestPrisma())
      .post("/api/v1/receiving-documents")
      .set("Authorization", bearer(operator))
      .send({ items: [] });

    expect(response.status).toBe(400);
    expect(asError(response.body).error.code).toBe("VALIDATION_ERROR");
  });

  it("DOC-03: rejects an unknown product with 404", async () => {
    const operator = await operatorToken();

    const response = await api(getTestPrisma())
      .post("/api/v1/receiving-documents")
      .set("Authorization", bearer(operator))
      .send({
        items: [{ productId: "00000000-0000-4000-8000-000000000000", expectedQuantity: 5 }],
      });

    expect(response.status).toBe(404);
    expect(asError(response.body).error.code).toBe("NOT_FOUND");
    expect(await getTestPrisma().receivingDocument.count()).toBe(0);
  });

  it.each([
    ["DOC-04 zero", 0],
    ["DOC-05 negative", -3],
    ["DOC-06 fractional", 2.5],
  ])("%s expected quantity returns 400 INVALID_QUANTITY", async (_label, expectedQuantity) => {
    const { ids } = await seedProducts();

    const response = await api(getTestPrisma())
      .post("/api/v1/receiving-documents")
      .set("Authorization", bearer(await operatorToken()))
      .send({ items: [{ productId: ids[0], expectedQuantity }] });

    expect(response.status).toBe(400);
    expect(asError(response.body).error.code).toBe("INVALID_QUANTITY");
    expect(await getTestPrisma().receivingDocument.count()).toBe(0);
  });

  it("DOC-07: rejects a duplicate product with 409", async () => {
    const { ids } = await seedProducts();

    const response = await api(getTestPrisma())
      .post("/api/v1/receiving-documents")
      .set("Authorization", bearer(await operatorToken()))
      .send({
        items: [
          { productId: ids[0], expectedQuantity: 10 },
          { productId: ids[0], expectedQuantity: 5 },
        ],
      });

    expect(response.status).toBe(409);
    expect(asError(response.body).error.code).toBe("DUPLICATE_DOCUMENT_ITEM");
    expect(await getTestPrisma().receivingDocument.count()).toBe(0);
  });

  it("DOC-11: generates unique sequential document numbers", async () => {
    const { supervisor, ids } = await seedProducts();

    const first = await api(getTestPrisma())
      .post("/api/v1/receiving-documents")
      .set("Authorization", bearer(supervisor))
      .send({ items: [{ productId: ids[0], expectedQuantity: 1 }] });
    const second = await api(getTestPrisma())
      .post("/api/v1/receiving-documents")
      .set("Authorization", bearer(supervisor))
      .send({ items: [{ productId: ids[1], expectedQuantity: 1 }] });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const firstNumber = asDocument(first.body).data.documentNumber;
    const secondNumber = asDocument(second.body).data.documentNumber;
    expect(firstNumber).not.toBe(secondNumber);

    const today = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    expect(firstNumber.startsWith(`RCV-${today}-`)).toBe(true);
    expect(secondNumber.startsWith(`RCV-${today}-`)).toBe(true);
  });

  it("DOC-12: one collision retries with the next number and succeeds", async () => {
    const prisma = getTestPrisma();
    const { supervisor, ids } = await seedProducts();
    const operator = await createUserWithToken(prisma, {
      email: "operator.collide@example.com",
      role: "OPERATOR",
    });

    // Rewind the sequence so the next creation draws a number we then
    // occupy directly: the service's first attempt collides, the retry
    // draws the following value and succeeds.
    const drawn = await prisma.$queryRaw<Array<{ next: bigint }>>`
      SELECT nextval('receiving_document_number_seq') AS next
    `;
    const last = Number(drawn[0]?.next ?? 1n);
    await prisma.$executeRawUnsafe(
      `SELECT setval('receiving_document_number_seq', ${last}, false)`,
    );
    const datePart = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    const collidingNumber = `RCV-${datePart}-${String(last).padStart(6, "0")}`;
    await prisma.receivingDocument.create({
      data: {
        documentNumber: collidingNumber,
        createdBy: operator.id,
        items: { create: { productId: ids[1], expectedQuantity: 7 } },
      },
    });

    const response = await api(prisma)
      .post("/api/v1/receiving-documents")
      .set("Authorization", bearer(supervisor))
      .send({ items: [{ productId: ids[0], expectedQuantity: 1 }] });

    expect(response.status).toBe(201);
    const number = asDocument(response.body).data.documentNumber;
    expect(number).not.toBe(collidingNumber);
    expect(number).toMatch(/^RCV-\d{8}-\d{6}$/);
  });

  it("DOC-13: persistent collisions exhaust retries with 500 and no rows", async () => {
    const prisma = getTestPrisma();
    const { supervisor, ids } = await seedProducts();
    const operator = await createUserWithToken(prisma, {
      email: "operator.collide3@example.com",
      role: "OPERATOR",
    });

    // Occupy the next three numbers the generator would draw so every
    // attempt (1 initial + within-limit retries) collides.
    const drawn = await prisma.$queryRaw<Array<{ next: bigint }>>`
      SELECT nextval('receiving_document_number_seq') AS next
    `;
    const last = Number(drawn[0]?.next ?? 1n);
    await prisma.$executeRawUnsafe(
      `SELECT setval('receiving_document_number_seq', ${last}, false)`,
    );
    const datePart = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    for (const offset of [0, 1, 2]) {
      const number = `RCV-${datePart}-${String(last + offset).padStart(6, "0")}`;
      await prisma.receivingDocument.create({
        data: {
          documentNumber: number,
          createdBy: operator.id,
          items: { create: { productId: ids[1], expectedQuantity: 7 } },
        },
      });
    }
    const before = await prisma.receivingDocument.count();

    const response = await api(prisma)
      .post("/api/v1/receiving-documents")
      .set("Authorization", bearer(supervisor))
      .send({ items: [{ productId: ids[0], expectedQuantity: 1 }] });

    expect(response.status).toBe(500);
    expect(asError(response.body).error.code).toBe("INTERNAL_ERROR");
    // No partial document or item rows remain from the failed creation.
    expect(await prisma.receivingDocument.count()).toBe(before);
  });

  it("rejects unauthenticated creation with 401", async () => {
    const response = await api(getTestPrisma())
      .post("/api/v1/receiving-documents")
      .send({ items: [] });

    expect(response.status).toBe(401);
    expect(asError(response.body).error.code).toBe("UNAUTHENTICATED");
  });
});

describe("GET /api/v1/receiving-documents", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await disconnectTestDatabase();
  });

  it("lists documents with pagination and derived totals", async () => {
    const { supervisor, ids } = await seedProducts();

    await api(getTestPrisma())
      .post("/api/v1/receiving-documents")
      .set("Authorization", bearer(supervisor))
      .send({ items: [{ productId: ids[0], expectedQuantity: 10 }] });
    await api(getTestPrisma())
      .post("/api/v1/receiving-documents")
      .set("Authorization", bearer(supervisor))
      .send({ items: [{ productId: ids[1], expectedQuantity: 20 }] });

    const response = await api(getTestPrisma())
      .get("/api/v1/receiving-documents?page=1&limit=20")
      .set("Authorization", bearer(supervisor));

    expect(response.status).toBe(200);
    const body = asList(response.body);
    expect(body.meta.total).toBe(2);
    expect(body.data).toHaveLength(2);
    for (const summary of body.data) {
      expect(summary.createdBy).toBeUndefined();
      expect(summary.items).toBeUndefined();
      expect(summary.totalItems).toBeGreaterThanOrEqual(1);
    }
  });

  it("filters by status and document-number search", async () => {
    const { supervisor, ids } = await seedProducts();

    const created = await api(getTestPrisma())
      .post("/api/v1/receiving-documents")
      .set("Authorization", bearer(supervisor))
      .send({ items: [{ productId: ids[0], expectedQuantity: 10 }] });
    const number = asDocument(created.body).data.documentNumber;

    const byStatus = await api(getTestPrisma())
      .get("/api/v1/receiving-documents?status=PENDING")
      .set("Authorization", bearer(supervisor));
    expect(byStatus.status).toBe(200);
    expect(asList(byStatus.body).meta.total).toBe(1);

    const bySearch = await api(getTestPrisma())
      .get(`/api/v1/receiving-documents?search=${number.slice(-6)}`)
      .set("Authorization", bearer(supervisor));
    expect(bySearch.status).toBe(200);
    expect(asList(bySearch.body).meta.total).toBe(1);

    const badStatus = await api(getTestPrisma())
      .get("/api/v1/receiving-documents?status=SHIPPED")
      .set("Authorization", bearer(supervisor));
    expect(badStatus.status).toBe(400);
    expect(asError(badStatus.body).error.code).toBe("VALIDATION_ERROR");
  });
});

describe("GET /api/v1/receiving-documents/:id", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await disconnectTestDatabase();
  });

  it("does not expose password hashes or other sensitive fields", async () => {
    const { supervisor, ids } = await seedProducts();

    const created = await api(getTestPrisma())
      .post("/api/v1/receiving-documents")
      .set("Authorization", bearer(supervisor))
      .send({ items: [{ productId: ids[0], expectedQuantity: 10 }] });
    const id = asDocument(created.body).data.id;

    const detail = await api(getTestPrisma())
      .get(`/api/v1/receiving-documents/${id}`)
      .set("Authorization", bearer(supervisor));
    expect(detail.status).toBe(200);
    // The creator is exactly the public user shape; the list endpoint
    // already asserts `createdBy`/`items` are absent from summaries.
    expect((detail.body as { data: { createdBy: unknown } }).data.createdBy).toEqual({
      // `expect.any()` returns `any`; the assertions keep type-aware lint green.
      id: expect.any(String) as string,
      email: expect.any(String) as string,
      role: "SUPERVISOR",
    });
    expect(JSON.stringify(detail.body)).not.toMatch(/password|hash|secret|token/i);
  });

  it("DOC-08: returns the document with items", async () => {
    const { supervisor, ids } = await seedProducts();

    const created = await api(getTestPrisma())
      .post("/api/v1/receiving-documents")
      .set("Authorization", bearer(supervisor))
      .send({ items: [{ productId: ids[0], expectedQuantity: 10 }] });
    const id = asDocument(created.body).data.id;

    const response = await api(getTestPrisma())
      .get(`/api/v1/receiving-documents/${id}`)
      .set("Authorization", bearer(supervisor));

    expect(response.status).toBe(200);
    const document = asDocument(response.body).data;
    expect(document.id).toBe(id);
    expect(document.items).toHaveLength(1);
    expect(document.items[0]?.sku).toBe("DOC-A-001");
    expect(document.items[0]?.productName).toBe("Product DOC-A-001");
  });

  it("DOC-09: returns 404 for an unknown document", async () => {
    const supervisor = await supervisorToken();

    const response = await api(getTestPrisma())
      .get("/api/v1/receiving-documents/00000000-0000-4000-8000-000000000000")
      .set("Authorization", bearer(supervisor));

    expect(response.status).toBe(404);
    expect(asError(response.body).error.code).toBe("NOT_FOUND");
  });

  it("DOC-14: returns 400 for a malformed identifier", async () => {
    const supervisor = await supervisorToken();

    const response = await api(getTestPrisma())
      .get("/api/v1/receiving-documents/not-a-uuid")
      .set("Authorization", bearer(supervisor));

    expect(response.status).toBe(400);
    expect(asError(response.body).error.code).toBe("VALIDATION_ERROR");
  });
});
