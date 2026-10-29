/**
 * Product management tests (PROD-01 … PROD-10 in `docs/testing.md`).
 *
 * Creation must be supervisor-only, must normalise the SKU, must reject a
 * duplicate after normalisation, and must leave no product behind when the
 * inventory insert fails.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { api, bearer, createUserWithToken } from "./helpers/api.js";
import { disconnectTestDatabase, getTestPrisma, resetDatabase } from "./helpers/db.js";

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

interface CreatedProductBody {
  data: {
    id: string;
    sku: string;
    name: string;
    availableQuantity: number;
    createdAt: string;
    updatedAt: string;
  };
}

interface ProductListBody {
  data: Array<{
    id: string;
    sku: string;
    name: string;
    availableQuantity: number;
    createdAt: string;
    updatedAt: string;
  }>;
  meta: { page: number; limit: number; total: number };
}

const asError = (body: unknown): ErrorBody => body as ErrorBody;
const asProduct = (body: unknown): CreatedProductBody => body as CreatedProductBody;
const asList = (body: unknown): ProductListBody => body as ProductListBody;

async function supervisorToken(): Promise<string> {
  const user = await createUserWithToken(getTestPrisma(), {
    email: "supervisor.products@example.com",
    role: "SUPERVISOR",
  });
  return user.token;
}

async function operatorToken(): Promise<string> {
  const user = await createUserWithToken(getTestPrisma(), {
    email: "operator.products@example.com",
    role: "OPERATOR",
  });
  return user.token;
}

describe("POST /api/v1/products", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await disconnectTestDatabase();
  });

  it("creates a product for a supervisor and returns 201", async () => {
    const token = await supervisorToken();

    const response = await api(getTestPrisma())
      .post("/api/v1/products")
      .set("Authorization", bearer(token))
      .send({ sku: "WIDGET-001", name: "Blue Widget" });

    expect(response.status).toBe(201);
    const body = asProduct(response.body);
    expect(body.data).toMatchObject({
      sku: "WIDGET-001",
      name: "Blue Widget",
      availableQuantity: 0,
    });
    expect(body.data.id).toEqual(expect.any(String));
    expect(new Date(body.data.createdAt).toString()).not.toBe("Invalid Date");
    expect(new Date(body.data.updatedAt).toString()).not.toBe("Invalid Date");
  });

  it("normalises the SKU by trimming and upper-casing", async () => {
    const token = await supervisorToken();

    const response = await api(getTestPrisma())
      .post("/api/v1/products")
      .set("Authorization", bearer(token))
      .send({ sku: "  widget-002  ", name: "  Blue Widget  " });

    expect(response.status).toBe(201);
    expect(asProduct(response.body).data.sku).toBe("WIDGET-002");
    expect(asProduct(response.body).data.name).toBe("Blue Widget");
  });

  it("creates the inventory row with zero stock in the same transaction", async () => {
    const token = await supervisorToken();

    const response = await api(getTestPrisma())
      .post("/api/v1/products")
      .set("Authorization", bearer(token))
      .send({ sku: "WIDGET-003", name: "Blue Widget" });

    const productId = asProduct(response.body).data.id;
    const inventory = await getTestPrisma().inventory.findUnique({
      where: { productId },
    });

    expect(inventory).not.toBeNull();
    expect(inventory?.availableQuantity).toBe(0);
  });

  it("does not leak fields the contract does not define", async () => {
    const token = await supervisorToken();

    const response = await api(getTestPrisma())
      .post("/api/v1/products")
      .set("Authorization", bearer(token))
      .send({ sku: "WIDGET-004", name: "Blue Widget" });

    expect(Object.keys(asProduct(response.body).data).sort()).toEqual([
      "availableQuantity",
      "createdAt",
      "id",
      "name",
      "sku",
      "updatedAt",
    ]);
  });

  it("returns 403 FORBIDDEN for an operator", async () => {
    const token = await operatorToken();

    const response = await api(getTestPrisma())
      .post("/api/v1/products")
      .set("Authorization", bearer(token))
      .send({ sku: "WIDGET-005", name: "Blue Widget" });

    expect(response.status).toBe(403);
    expect(asError(response.body).error.code).toBe("FORBIDDEN");
    await expect(getTestPrisma().product.count()).resolves.toBe(0);
  });

  it("returns 401 UNAUTHENTICATED without a token", async () => {
    const response = await api(getTestPrisma())
      .post("/api/v1/products")
      .send({ sku: "WIDGET-006", name: "Blue Widget" });

    expect(response.status).toBe(401);
    expect(asError(response.body).error.code).toBe("UNAUTHENTICATED");
    await expect(getTestPrisma().product.count()).resolves.toBe(0);
  });

  it.each([
    ["a missing sku", { name: "Blue Widget" }],
    ["a missing name", { sku: "WIDGET-007" }],
    ["a blank sku", { sku: "   ", name: "Blue Widget" }],
    ["a blank name", { sku: "WIDGET-007", name: "   " }],
    ["a sku over 100 characters", { sku: "S".repeat(101), name: "Blue Widget" }],
    ["a name over 255 characters", { sku: "WIDGET-007", name: "N".repeat(256) }],
    ["a non-string sku", { sku: 123, name: "Blue Widget" }],
    ["an empty body", {}],
  ])("rejects %s with 400 VALIDATION_ERROR", async (_label, payload) => {
    const token = await supervisorToken();

    const response = await api(getTestPrisma())
      .post("/api/v1/products")
      .set("Authorization", bearer(token))
      .send(payload);

    expect(response.status).toBe(400);
    expect(asError(response.body).error.code).toBe("VALIDATION_ERROR");
    await expect(getTestPrisma().product.count()).resolves.toBe(0);
  });

  it("returns 409 DUPLICATE_SKU for an identical SKU", async () => {
    const token = await supervisorToken();
    const payload = { sku: "WIDGET-008", name: "Blue Widget" };

    await api(getTestPrisma())
      .post("/api/v1/products")
      .set("Authorization", bearer(token))
      .send(payload);

    const response = await api(getTestPrisma())
      .post("/api/v1/products")
      .set("Authorization", bearer(token))
      .send(payload);

    expect(response.status).toBe(409);
    expect(asError(response.body).error.code).toBe("DUPLICATE_SKU");
    await expect(getTestPrisma().product.count()).resolves.toBe(1);
  });

  it("treats a case- and whitespace-different SKU as a duplicate", async () => {
    const token = await supervisorToken();

    await api(getTestPrisma())
      .post("/api/v1/products")
      .set("Authorization", bearer(token))
      .send({ sku: "WIDGET-009", name: "Blue Widget" });

    const response = await api(getTestPrisma())
      .post("/api/v1/products")
      .set("Authorization", bearer(token))
      .send({ sku: "  widget-009 ", name: "Another Widget" });

    expect(response.status).toBe(409);
    expect(asError(response.body).error.code).toBe("DUPLICATE_SKU");
    await expect(getTestPrisma().product.count()).resolves.toBe(1);
    await expect(getTestPrisma().inventory.count()).resolves.toBe(1);
  });

  it("accepts a SKU of exactly 100 characters", async () => {
    const token = await supervisorToken();
    const sku = "S".repeat(100);

    const response = await api(getTestPrisma())
      .post("/api/v1/products")
      .set("Authorization", bearer(token))
      .send({ sku, name: "Long SKU Widget" });

    expect(response.status).toBe(201);
    expect(asProduct(response.body).data.sku).toBe(sku);
  });

});

/**
 * Atomicity is verified against the real database rather than a stub.
 *
 * A trigger makes `inventories` reject every insert for the duration of the
 * case, so the product insert succeeds and the inventory insert fails inside
 * the same `$transaction`. That is the exact failure the requirement names, and
 * it lets PostgreSQL's rollback behaviour be observed instead of assumed.
 */
describe("product and inventory atomicity", () => {
  const FAILURE_MESSAGE = "simulated-inventory-failure";

  async function installInventoryRejection(): Promise<void> {
    const prisma = getTestPrisma();
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION fail_inventory_insert() RETURNS trigger AS $fn$
      BEGIN
        RAISE EXCEPTION '${FAILURE_MESSAGE}';
      END;
      $fn$ LANGUAGE plpgsql;
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER fail_inventory_insert
      BEFORE INSERT ON "inventories"
      FOR EACH ROW EXECUTE FUNCTION fail_inventory_insert();
    `);
  }

  async function removeInventoryRejection(): Promise<void> {
    const prisma = getTestPrisma();
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS fail_inventory_insert ON "inventories";`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS fail_inventory_insert();`);
  }

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await removeInventoryRejection();
    await disconnectTestDatabase();
  });

  it("leaves no product behind when the inventory insert fails", async () => {
    const token = await supervisorToken();
    await installInventoryRejection();

    try {
      const response = await api(getTestPrisma())
        .post("/api/v1/products")
        .set("Authorization", bearer(token))
        .send({ sku: "WIDGET-012", name: "Orphan Check" });

      expect(response.status).toBe(500);
      expect(asError(response.body).error.code).toBe("INTERNAL_ERROR");
    } finally {
      await removeInventoryRejection();
    }

    await expect(getTestPrisma().product.count()).resolves.toBe(0);
    await expect(getTestPrisma().inventory.count()).resolves.toBe(0);
  });

  it("does not expose the database error to a production client", async () => {
    const token = await supervisorToken();
    await installInventoryRejection();

    try {
      // Production mode is the case that matters: in development the shared
      // handler deliberately keeps the original message as a debugging
      // breadcrumb, and that behaviour is covered by the health tests.
      const response = await api(getTestPrisma(), {
        nodeEnv: "production",
        isProduction: true,
      })
        .post("/api/v1/products")
        .set("Authorization", bearer(token))
        .send({ sku: "WIDGET-013", name: "Orphan Check" });

      const body = asError(response.body);
      expect(response.status).toBe(500);
      expect(body.error.code).toBe("INTERNAL_ERROR");
      expect(body.error.details).toBeUndefined();

      const serialised = JSON.stringify(body);
      expect(serialised).not.toContain(FAILURE_MESSAGE);
      expect(serialised).not.toMatch(/plpgsql|trigger|prisma|inventories/i);
    } finally {
      await removeInventoryRejection();
    }
  });

  it("still creates both rows once the failure is removed", async () => {
    const token = await supervisorToken();

    const response = await api(getTestPrisma())
      .post("/api/v1/products")
      .set("Authorization", bearer(token))
      .send({ sku: "WIDGET-014", name: "Recovered Product" });

    expect(response.status).toBe(201);
    await expect(getTestPrisma().product.count()).resolves.toBe(1);
    await expect(getTestPrisma().inventory.count()).resolves.toBe(1);
  });
});

describe("GET /api/v1/products", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await disconnectTestDatabase();
  });

  it("returns an empty page with the documented meta shape", async () => {
    const token = await operatorToken();

    const response = await api(getTestPrisma())
      .get("/api/v1/products")
      .set("Authorization", bearer(token));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: [],
      meta: { page: 1, limit: 20, total: 0 },
    });
  });

  it("is available to both roles", async () => {
    const supervisor = await supervisorToken();
    const operator = await operatorToken();

    const supervisorResponse = await api(getTestPrisma())
      .get("/api/v1/products")
      .set("Authorization", bearer(supervisor));
    const operatorResponse = await api(getTestPrisma())
      .get("/api/v1/products")
      .set("Authorization", bearer(operator));

    expect(supervisorResponse.status).toBe(200);
    expect(operatorResponse.status).toBe(200);
  });

  it("requires authentication", async () => {
    const response = await api(getTestPrisma()).get("/api/v1/products");

    expect(response.status).toBe(401);
    expect(asError(response.body).error.code).toBe("UNAUTHENTICATED");
  });

  it("reports persisted inventory and paginates", async () => {
    const token = await supervisorToken();

    for (const sku of ["LIST-001", "LIST-002", "LIST-003"]) {
      await api(getTestPrisma())
        .post("/api/v1/products")
        .set("Authorization", bearer(token))
        .send({ sku, name: `Product ${sku}` });
    }

    const response = await api(getTestPrisma())
      .get("/api/v1/products?page=2&limit=2")
      .set("Authorization", bearer(token));

    expect(response.status).toBe(200);
    const body = asList(response.body);
    expect(body.meta).toEqual({ page: 2, limit: 2, total: 3 });
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.availableQuantity).toBe(0);
  });

  it("filters by SKU or name, case-insensitively", async () => {
    const token = await supervisorToken();

    await api(getTestPrisma())
      .post("/api/v1/products")
      .set("Authorization", bearer(token))
      .send({ sku: "ALPHA-1", name: "Alpha Widget" });
    await api(getTestPrisma())
      .post("/api/v1/products")
      .set("Authorization", bearer(token))
      .send({ sku: "BETA-1", name: "Beta Gadget" });

    const bySku = await api(getTestPrisma())
      .get("/api/v1/products?search=alpha")
      .set("Authorization", bearer(token));
    const byName = await api(getTestPrisma())
      .get("/api/v1/products?search=gadget")
      .set("Authorization", bearer(token));

    expect(asList(bySku.body).data.map((product) => product.sku)).toEqual(["ALPHA-1"]);
    expect(asList(byName.body).data.map((product) => product.sku)).toEqual(["BETA-1"]);
  });

  it.each([
    ["page=0", "page must be at least 1"],
    ["page=abc", "page must be an integer"],
    ["limit=0", "limit must be at least 1"],
    ["limit=101", "limit must be at most 100"],
    ["limit=1.5", "limit must be an integer"],
  ])("rejects the invalid query %s with 400", async (query) => {
    const token = await operatorToken();

    const response = await api(getTestPrisma())
      .get(`/api/v1/products?${query}`)
      .set("Authorization", bearer(token));

    expect(response.status).toBe(400);
    expect(asError(response.body).error.code).toBe("VALIDATION_ERROR");
  });

  it("treats an empty search as no filter", async () => {
    const token = await operatorToken();

    const response = await api(getTestPrisma())
      .get("/api/v1/products?search=")
      .set("Authorization", bearer(token));

    expect(response.status).toBe(200);
  });
});
