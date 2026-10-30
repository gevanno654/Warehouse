/**
 * Product management logic.
 *
 * Business rules from `docs/prd.md` FR-02 and `docs/technical-spec.md` §4.2:
 * - SKU is trimmed and upper-cased before persistence, so uniqueness is
 *   case-insensitive and whitespace-insensitive.
 * - A product and its single `inventories` row are committed in one
 *   transaction. A product without inventory is not a valid state.
 * - Creation is restricted to `SUPERVISOR`; that check lives in the route
 *   because it is an authorisation concern, not a data concern.
 */
import { Prisma } from "@prisma/client";

import type { PrismaClient } from "@prisma/client";

import { duplicateSkuError } from "../../lib/errors.js";

export interface ProductView {
  readonly id: string;
  readonly sku: string;
  readonly name: string;
  readonly availableQuantity: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateProductInput {
  readonly sku: string;
  readonly name: string;
}

/** Normalises a SKU for storage and comparison. */
export function normaliseSku(sku: string): string {
  return sku.trim().toUpperCase();
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

/**
 * Creates a product and its zero-quantity inventory row atomically.
 *
 * The inventory insert is inside the same `$transaction` callback, so a failure
 * on either statement leaves neither row behind. Relying on the database
 * unique index (rather than a prior read) also makes concurrent creates of the
 * same SKU return `409` instead of a duplicate row.
 *
 * @throws {AppError} `409 DUPLICATE_SKU` when the normalised SKU already exists.
 */
export async function createProduct(
  prisma: PrismaClient,
  input: CreateProductInput,
): Promise<ProductView> {
  const sku = normaliseSku(input.sku);
  const name = input.name.trim();

  try {
    const created = await prisma.$transaction(async (tx) => {
      const product = await tx.product.create({ data: { sku, name } });

      // `available_quantity` defaults to 0 in the schema; it is set explicitly
      // so the invariant is visible at the point of creation.
      const inventory = await tx.inventory.create({
        data: { productId: product.id, availableQuantity: 0 },
      });

      return { product, inventory };
    });

    return {
      id: created.product.id,
      sku: created.product.sku,
      name: created.product.name,
      // Reported from the row that was just written rather than assumed.
      availableQuantity: created.inventory.availableQuantity,
      createdAt: created.product.createdAt,
      updatedAt: created.product.updatedAt,
    };
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      throw duplicateSkuError();
    }
    throw error;
  }
}

export interface ListProductsInput {
  readonly page: number;
  readonly limit: number;
  readonly search: string | undefined;
}

export interface ListProductsResult {
  readonly products: readonly ProductView[];
  readonly total: number;
  readonly page: number;
  readonly limit: number;
}

/**
 * Lists products with their current stock.
 *
 * `availableQuantity` is read from the joined inventory row rather than
 * computed, so the API reports persisted stock. A product always has exactly
 * one inventory row, but the join is written defensively so a missing row
 * cannot produce an undefined value in the response.
 */
export async function listProducts(
  prisma: PrismaClient,
  input: ListProductsInput,
): Promise<ListProductsResult> {
  const search = input.search;
  const where: Prisma.ProductWhereInput =
    search === undefined
      ? {}
      : {
          OR: [
            { sku: { contains: search, mode: "insensitive" } },
            { name: { contains: search, mode: "insensitive" } },
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
    products: rows.map((row) => ({
      id: row.id,
      sku: row.sku,
      name: row.name,
      availableQuantity: row.inventory?.availableQuantity ?? 0,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })),
    total,
    page: input.page,
    limit: input.limit,
  };
}
