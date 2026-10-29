/**
 * Inventory queries: current stock and the immutable transaction history.
 *
 * Both endpoints report persisted values only. `availableQuantity` is read
 * from the joined inventory row; a product always has exactly one inventory
 * row, but the join is written defensively so a missing row cannot produce
 * an undefined value in the response (same convention as `products`).
 *
 * Transaction history is newest-first and carries only the display fields
 * the contract defines: the performer's email, never password hashes or
 * other sensitive user data.
 */
import type { Prisma, PrismaClient } from "@prisma/client";

export interface InventoryItemView {
  readonly productId: string;
  readonly sku: string;
  readonly name: string;
  readonly availableQuantity: number;
}

export interface ListInventoryInput {
  readonly page: number;
  readonly limit: number;
  readonly search: string | undefined;
}

export interface ListInventoryResult {
  readonly items: readonly InventoryItemView[];
  readonly total: number;
  readonly page: number;
  readonly limit: number;
}

/** Lists current inventory, newest products first, with SKU/name search. */
export async function listInventory(
  prisma: PrismaClient,
  input: ListInventoryInput,
): Promise<ListInventoryResult> {
  const where: Prisma.ProductWhereInput =
    input.search === undefined
      ? {}
      : {
          OR: [
            { sku: { contains: input.search, mode: "insensitive" } },
            { name: { contains: input.search, mode: "insensitive" } },
          ],
        };

  const [rows, total] = await prisma.$transaction([
    prisma.product.findMany({
      where,
      include: { inventory: true },
      orderBy: { createdAt: "desc" },
      skip: (input.page - 1) * input.limit,
      take: input.limit,
    }),
    prisma.product.count({ where }),
  ]);

  return {
    items: rows.map((row) => ({
      productId: row.id,
      sku: row.sku,
      name: row.name,
      availableQuantity: row.inventory?.availableQuantity ?? 0,
    })),
    total,
    page: input.page,
    limit: input.limit,
  };
}

export interface InventoryTransactionView {
  readonly id: string;
  readonly productId: string;
  readonly sku: string;
  readonly transactionType: "RECEIPT";
  readonly quantityChange: number;
  readonly documentNumber: string;
  readonly performedBy: string;
  readonly createdAt: Date;
}

export interface ListInventoryTransactionsInput {
  readonly page: number;
  readonly limit: number;
  readonly productId: string | undefined;
  readonly from: Date | undefined;
  readonly to: Date | undefined;
}

export interface ListInventoryTransactionsResult {
  readonly transactions: readonly InventoryTransactionView[];
  readonly total: number;
  readonly page: number;
  readonly limit: number;
}

/**
 * Lists inventory transactions, newest first.
 *
 * `from`/`to` are inclusive ISO 8601 bounds on `created_at`. The document
 * number is resolved through the receiving item so the history line names
 * the document the goods were received against.
 */
export async function listInventoryTransactions(
  prisma: PrismaClient,
  input: ListInventoryTransactionsInput,
): Promise<ListInventoryTransactionsResult> {
  const where: Prisma.InventoryTransactionWhereInput = {
    ...(input.productId === undefined ? {} : { productId: input.productId }),
    ...((input.from === undefined && input.to === undefined)
      ? {}
      : {
          createdAt: {
            ...(input.from === undefined ? {} : { gte: input.from }),
            ...(input.to === undefined ? {} : { lte: input.to }),
          },
        }),
  };

  const [rows, total] = await prisma.$transaction([
    prisma.inventoryTransaction.findMany({
      where,
      include: {
        product: { select: { sku: true } },
        receivingItem: {
          select: { document: { select: { documentNumber: true } } },
        },
        performer: { select: { email: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (input.page - 1) * input.limit,
      take: input.limit,
    }),
    prisma.inventoryTransaction.count({ where }),
  ]);

  return {
    transactions: rows.map((row) => ({
      id: row.id,
      productId: row.productId,
      sku: row.product.sku,
      transactionType: row.transactionType,
      quantityChange: row.quantityChange,
      documentNumber: row.receivingItem.document.documentNumber,
      performedBy: row.performer.email,
      createdAt: row.createdAt,
    })),
    total,
    page: input.page,
    limit: input.limit,
  };
}
