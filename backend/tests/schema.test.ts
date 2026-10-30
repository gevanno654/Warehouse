import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { disconnectTestDatabase, getTestPrisma, resetDatabase } from "./helpers/db.js";

/**
 * Database-backed schema tests.
 *
 * These require a reachable test database named with a `_test` suffix
 * (`TEST_DATABASE_URL`). They assert the constraints that
 * `docs/data-model.md` requires the database to enforce.
 */

const prisma = () => getTestPrisma();

async function createUser(email = "creator@example.com") {
  return prisma().user.create({
    data: { email, passwordHash: "hash", role: "SUPERVISOR" },
  });
}

async function createProduct(sku = "SKU-1") {
  return prisma().product.create({ data: { sku, name: "Test product" } });
}

describe("schema integrity", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await disconnectTestDatabase();
  });

  describe("users", () => {
    it("enforces unique email", async () => {
      await createUser("dup@example.com");

      await expect(createUser("dup@example.com")).rejects.toThrow();
    });

    it("stores the approved role enum values", async () => {
      const user = await prisma().user.create({
        data: { email: "role@example.com", passwordHash: "h", role: "OPERATOR" },
      });

      expect(user.role).toBe("OPERATOR");
    });
  });

  describe("products", () => {
    it("enforces unique sku", async () => {
      await createProduct("SKU-DUP");

      await expect(createProduct("SKU-DUP")).rejects.toThrow();
    });
  });

  describe("receiving_documents", () => {
    it("enforces unique document_number", async () => {
      const user = await createUser();

      await prisma().receivingDocument.create({
        data: { documentNumber: "RCV-20260101-000001", createdBy: user.id },
      });

      await expect(
        prisma().receivingDocument.create({
          data: { documentNumber: "RCV-20260101-000001", createdBy: user.id },
        }),
      ).rejects.toThrow();
    });

    it("defaults status to PENDING", async () => {
      const user = await createUser();

      const document = await prisma().receivingDocument.create({
        data: { documentNumber: "RCV-20260101-000002", createdBy: user.id },
      });

      expect(document.status).toBe("PENDING");
    });
  });

  describe("receiving_items", () => {
    it("enforces UNIQUE (document_id, product_id)", async () => {
      const user = await createUser();
      const product = await createProduct("SKU-UNIQ");
      const document = await prisma().receivingDocument.create({
        data: { documentNumber: "RCV-20260101-000003", createdBy: user.id },
      });

      await prisma().receivingItem.create({
        data: { documentId: document.id, productId: product.id, expectedQuantity: 5 },
      });

      await expect(
        prisma().receivingItem.create({
          data: { documentId: document.id, productId: product.id, expectedQuantity: 3 },
        }),
      ).rejects.toThrow();
    });

    it("allows the same product on a different document", async () => {
      const user = await createUser();
      const product = await createProduct("SKU-MULTI");
      const first = await prisma().receivingDocument.create({
        data: { documentNumber: "RCV-20260101-000004", createdBy: user.id },
      });
      const second = await prisma().receivingDocument.create({
        data: { documentNumber: "RCV-20260101-000005", createdBy: user.id },
      });

      await prisma().receivingItem.create({
        data: { documentId: first.id, productId: product.id, expectedQuantity: 5 },
      });

      await expect(
        prisma().receivingItem.create({
          data: { documentId: second.id, productId: product.id, expectedQuantity: 5 },
        }),
      ).resolves.toBeDefined();
    });

    it("rejects a non-positive expected_quantity at the database level", async () => {
      const user = await createUser();
      const product = await createProduct("SKU-POS");
      const document = await prisma().receivingDocument.create({
        data: { documentNumber: "RCV-20260101-000006", createdBy: user.id },
      });

      await expect(
        prisma().receivingItem.create({
          data: { documentId: document.id, productId: product.id, expectedQuantity: 0 },
        }),
      ).rejects.toThrow();
    });

    it("rejects received_quantity greater than expected_quantity", async () => {
      const user = await createUser();
      const product = await createProduct("SKU-RANGE");
      const document = await prisma().receivingDocument.create({
        data: { documentNumber: "RCV-20260101-000007", createdBy: user.id },
      });

      await expect(
        prisma().receivingItem.create({
          data: {
            documentId: document.id,
            productId: product.id,
            expectedQuantity: 5,
            receivedQuantity: 6,
          },
        }),
      ).rejects.toThrow();
    });

    it("rejects a negative received_quantity", async () => {
      const user = await createUser();
      const product = await createProduct("SKU-NEG");
      const document = await prisma().receivingDocument.create({
        data: { documentNumber: "RCV-20260101-000008", createdBy: user.id },
      });

      await expect(
        prisma().receivingItem.create({
          data: {
            documentId: document.id,
            productId: product.id,
            expectedQuantity: 5,
            receivedQuantity: -1,
          },
        }),
      ).rejects.toThrow();
    });
  });

  describe("inventories", () => {
    it("defaults available_quantity to 0", async () => {
      const product = await createProduct("SKU-INV");

      const inventory = await prisma().inventory.create({ data: { productId: product.id } });

      expect(inventory.availableQuantity).toBe(0);
    });

    it("enforces one inventory row per product", async () => {
      const product = await createProduct("SKU-INV2");
      await prisma().inventory.create({ data: { productId: product.id } });

      await expect(
        prisma().inventory.create({ data: { productId: product.id } }),
      ).rejects.toThrow();
    });

    it("rejects a negative available_quantity", async () => {
      const product = await createProduct("SKU-INV3");

      await expect(
        prisma().inventory.create({
          data: { productId: product.id, availableQuantity: -5 },
        }),
      ).rejects.toThrow();
    });
  });

  describe("receipt_operations idempotency", () => {
    async function makeItem(sku: string, documentNumber: string) {
      const user = await createUser(`${sku.toLowerCase()}@example.com`);
      const product = await createProduct(sku);
      const document = await prisma().receivingDocument.create({
        data: { documentNumber, createdBy: user.id },
      });
      const item = await prisma().receivingItem.create({
        data: { documentId: document.id, productId: product.id, expectedQuantity: 10 },
      });
      return { user, product, document, item };
    }

    const validHash = "a".repeat(64);

    it("enforces UNIQUE (performed_by, idempotency_key)", async () => {
      const { user, item } = await makeItem("SKU-IDEM", "RCV-20260101-000009");

      await prisma().receiptOperation.create({
        data: {
          performedBy: user.id,
          idempotencyKey: "key-1",
          requestHash: validHash,
          receivingItemId: item.id,
          quantity: 1,
          responseSnapshot: { ok: true },
        },
      });

      await expect(
        prisma().receiptOperation.create({
          data: {
            performedBy: user.id,
            idempotencyKey: "key-1",
            requestHash: validHash,
            receivingItemId: item.id,
            quantity: 1,
            responseSnapshot: { ok: true },
          },
        }),
      ).rejects.toThrow();
    });

    it("allows two users to use the same idempotency key value", async () => {
      const first = await makeItem("SKU-U1", "RCV-20260101-000010");
      const second = await makeItem("SKU-U2", "RCV-20260101-000011");

      await prisma().receiptOperation.create({
        data: {
          performedBy: first.user.id,
          idempotencyKey: "shared-key",
          requestHash: validHash,
          receivingItemId: first.item.id,
          quantity: 1,
          responseSnapshot: { ok: true },
        },
      });

      // The key is scoped per user, so the same value must be accepted here.
      await expect(
        prisma().receiptOperation.create({
          data: {
            performedBy: second.user.id,
            idempotencyKey: "shared-key",
            requestHash: validHash,
            receivingItemId: second.item.id,
            quantity: 1,
            responseSnapshot: { ok: true },
          },
        }),
      ).resolves.toBeDefined();
    });

    it("rejects a non-positive quantity", async () => {
      const { user, item } = await makeItem("SKU-Q0", "RCV-20260101-000012");

      await expect(
        prisma().receiptOperation.create({
          data: {
            performedBy: user.id,
            idempotencyKey: "zero-qty",
            requestHash: validHash,
            receivingItemId: item.id,
            quantity: 0,
            responseSnapshot: { ok: true },
          },
        }),
      ).rejects.toThrow();
    });

    it("rejects a request_hash that is not 64 lowercase hex characters", async () => {
      const { user, item } = await makeItem("SKU-HASH", "RCV-20260101-000013");

      await expect(
        prisma().receiptOperation.create({
          data: {
            performedBy: user.id,
            idempotencyKey: "bad-hash",
            requestHash: "not-a-sha256",
            receivingItemId: item.id,
            quantity: 1,
            responseSnapshot: { ok: true },
          },
        }),
      ).rejects.toThrow();
    });
  });

  describe("inventory_transactions", () => {
    it("enforces unique receipt_operation_id", async () => {
      const user = await createUser("tx@example.com");
      const product = await createProduct("SKU-TX");
      const document = await prisma().receivingDocument.create({
        data: { documentNumber: "RCV-20260101-000014", createdBy: user.id },
      });
      const item = await prisma().receivingItem.create({
        data: { documentId: document.id, productId: product.id, expectedQuantity: 10 },
      });
      const operation = await prisma().receiptOperation.create({
        data: {
          performedBy: user.id,
          idempotencyKey: "tx-key",
          requestHash: "b".repeat(64),
          receivingItemId: item.id,
          quantity: 2,
          responseSnapshot: { ok: true },
        },
      });

      await prisma().inventoryTransaction.create({
        data: {
          productId: product.id,
          receivingItemId: item.id,
          receiptOperationId: operation.id,
          transactionType: "RECEIPT",
          quantityChange: 2,
          performedBy: user.id,
        },
      });

      await expect(
        prisma().inventoryTransaction.create({
          data: {
            productId: product.id,
            receivingItemId: item.id,
            receiptOperationId: operation.id,
            transactionType: "RECEIPT",
            quantityChange: 2,
            performedBy: user.id,
          },
        }),
      ).rejects.toThrow();
    });

    it("rejects a non-positive quantity_change", async () => {
      const user = await createUser("tx2@example.com");
      const product = await createProduct("SKU-TX2");
      const document = await prisma().receivingDocument.create({
        data: { documentNumber: "RCV-20260101-000015", createdBy: user.id },
      });
      const item = await prisma().receivingItem.create({
        data: { documentId: document.id, productId: product.id, expectedQuantity: 10 },
      });
      const operation = await prisma().receiptOperation.create({
        data: {
          performedBy: user.id,
          idempotencyKey: "tx-key-2",
          requestHash: "c".repeat(64),
          receivingItemId: item.id,
          quantity: 2,
          responseSnapshot: { ok: true },
        },
      });

      await expect(
        prisma().inventoryTransaction.create({
          data: {
            productId: product.id,
            receivingItemId: item.id,
            receiptOperationId: operation.id,
            transactionType: "RECEIPT",
            quantityChange: -2,
            performedBy: user.id,
          },
        }),
      ).rejects.toThrow();
    });
  });

  describe("foreign keys", () => {
    it("prevents deleting a product that has receiving history", async () => {
      const user = await createUser("fk@example.com");
      const product = await createProduct("SKU-FK");
      const document = await prisma().receivingDocument.create({
        data: { documentNumber: "RCV-20260101-000016", createdBy: user.id },
      });
      await prisma().receivingItem.create({
        data: { documentId: document.id, productId: product.id, expectedQuantity: 1 },
      });

      await expect(
        prisma().product.delete({ where: { id: product.id } }),
      ).rejects.toThrow();
    });

    it("prevents deleting a user who created documents", async () => {
      const user = await createUser("fk2@example.com");
      await prisma().receivingDocument.create({
        data: { documentNumber: "RCV-20260101-000017", createdBy: user.id },
      });

      await expect(prisma().user.delete({ where: { id: user.id } })).rejects.toThrow();
    });
  });
});
