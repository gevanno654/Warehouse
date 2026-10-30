/**
 * Request validation.
 *
 * Every schema failure is a `400 VALIDATION_ERROR` per
 * `docs/openapi.yaml` and `docs/technical-spec.md` §5. Schemas are derived from
 * the approved contract; limits are copied from `docs/openapi.yaml` rather than
 * chosen here.
 */
import { z, type ZodType } from "zod";

import { idempotencyKeyRequiredError, invalidQuantityError } from "./errors.js";

/** `POST /api/v1/auth/login` request body. */
export const loginRequestSchema = z.object({
  // Emails are normalised to lower case before lookup, so the input is
  // validated as an email and trimmed but not otherwise transformed.
  email: z
    .string({ error: "email is required" })
    .trim()
    .min(1, "email is required")
    .max(255, "email must be at most 255 characters")
    .pipe(z.email("email must be a valid email address")),
  password: z
    .string({ error: "password is required" })
    .min(1, "password is required"),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;

/**
 * `POST /api/v1/products` request body.
 *
 * `sku` is limited to 100 characters and `name` to 255, matching
 * `docs/openapi.yaml`. Whitespace is trimmed here; the SKU is upper-cased in
 * the service so normalisation is visible next to the uniqueness check.
 */
export const createProductRequestSchema = z.object({
  sku: z
    .string({ error: "sku is required" })
    .trim()
    .min(1, "sku is required")
    .max(100, "sku must be at most 100 characters"),
  name: z
    .string({ error: "name is required" })
    .trim()
    .min(1, "name is required")
    .max(255, "name must be at most 255 characters"),
});

export type CreateProductRequest = z.infer<typeof createProductRequestSchema>;

/**
 * Path parameters shared by the document and receipt routes.
 *
 * A malformed UUID is a schema failure (`400 VALIDATION_ERROR`) per
 * `docs/technical-spec.md` §5.6, raised by the shared error handler.
 */
const uuidParamsSchema = z.object({
  id: z.uuid("id must be a valid UUID"),
  itemId: z.uuid("itemId must be a valid UUID").optional(),
});

export type UuidParams = z.infer<typeof uuidParamsSchema>;

export function parseUuidParams(value: unknown): UuidParams {
  return uuidParamsSchema.parse(value);
}

/**
 * `POST /api/v1/receiving-documents` request body.
 *
 * `expectedQuantity` must be a positive integer. The contract maps any
 * quantity-shaped failure — zero, negative, fractional, or non-numeric — to
 * `400 INVALID_QUANTITY` (§5.5), while every other schema failure stays
 * `400 VALIDATION_ERROR`. `parseOrQuantityError` below implements that split,
 * so the schema itself stays a plain description of the accepted shape.
 */
export const createReceivingDocumentRequestSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.uuid("productId must be a valid UUID"),
        expectedQuantity: z.number("expectedQuantity is required"),
      }),
      "items must be a non-empty array",
    )
    .min(1, "items must contain at least one item"),
});

export type CreateReceivingDocumentRequest = z.infer<
  typeof createReceivingDocumentRequestSchema
>;

/**
 * `POST .../receipts` request body.
 *
 * Same quantity rule as document items: any `quantity` failure is
 * `400 INVALID_QUANTITY`, resolved via `parseOrQuantityError`.
 */
export const recordReceiptRequestSchema = z.object({
  quantity: z.number("quantity is required"),
});

export type RecordReceiptRequest = z.infer<typeof recordReceiptRequestSchema>;

/**
 * Parses `data` and converts quantity-shaped failures to `INVALID_QUANTITY`.
 *
 * A failure is quantity-shaped when every issue sits under a `quantity` or
 * `expectedQuantity` path — i.e. the client sent the field but with a value
 * that is not a positive integer (zero, negative, fractional, non-numeric).
 * Missing fields, malformed UUIDs, and structural problems keep the default
 * `VALIDATION_ERROR` mapping in the shared error handler.
 *
 * The service performs the positive-integer check after parsing, so the
 * schema accepts any number here and this function decides the error code.
 */
export function parseOrQuantityError<T extends ZodType>(
  schema: T,
  data: unknown,
): z.infer<T> {
  const result = schema.safeParse(data);

  if (result.success) {
    return result.data;
  }

  const issues = result.error.issues;
  const allQuantityIssues =
    issues.length > 0 &&
    issues.every((issue) => {
      const leaf = issue.path[issue.path.length - 1];
      return leaf === "quantity" || leaf === "expectedQuantity";
    });

  if (allQuantityIssues) {
    throw invalidQuantityError();
  }

  throw result.error;
}

/** `quantity`/`expectedQuantity` must be a positive integer. */
export function assertPositiveInteger(quantity: number): void {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw invalidQuantityError();
  }
}

/**
 * Parses the `Idempotency-Key` header.
 *
 * Missing or empty → `400 IDEMPOTENCY_KEY_REQUIRED` (§5.6). A present but
 * over-long key is a schema failure (`400 VALIDATION_ERROR`), raised by
 * parsing the value with a length-capped schema so the message stays uniform.
 */
const idempotencyKeyValueSchema = z
  .string()
  .max(255, "Idempotency-Key must be at most 255 characters");

export function parseIdempotencyKey(header: unknown): string {
  if (typeof header !== "string" || header.length === 0) {
    throw idempotencyKeyRequiredError();
  }

  return idempotencyKeyValueSchema.parse(header);
}

/**
 * `GET /api/v1/receiving-documents` query string.
 *
 * `status` must be one of the three derived states; anything else is a
 * schema failure (`400 VALIDATION_ERROR`). `search` matches the generated
 * document number and is capped at 50 characters per the contract.
 */
export const listReceivingDocumentsQuerySchema = z.object({
  page: z.coerce
    .number({ error: "page must be an integer" })
    .int("page must be an integer")
    .min(1, "page must be at least 1")
    .default(1),
  limit: z.coerce
    .number({ error: "limit must be an integer" })
    .int("limit must be an integer")
    .min(1, "limit must be at least 1")
    .max(100, "limit must be at most 100")
    .default(20),
  status: z.enum(["PENDING", "PARTIALLY_RECEIVED", "COMPLETED"]).optional(),
  search: z
    .string()
    .trim()
    .max(50, "search must be at most 50 characters")
    .optional()
    .transform((value) => (value === "" ? undefined : value)),
});

export type ListReceivingDocumentsQuery = z.infer<
  typeof listReceivingDocumentsQuerySchema
>;

/** `GET /api/v1/inventory` query string. */
export const listInventoryQuerySchema = z.object({
  page: z.coerce
    .number({ error: "page must be an integer" })
    .int("page must be an integer")
    .min(1, "page must be at least 1")
    .default(1),
  limit: z.coerce
    .number({ error: "limit must be an integer" })
    .int("limit must be an integer")
    .min(1, "limit must be at least 1")
    .max(100, "limit must be at most 100")
    .default(20),
  search: z
    .string()
    .trim()
    .max(255, "search must be at most 255 characters")
    .optional()
    .transform((value) => (value === "" ? undefined : value)),
});

export type ListInventoryQuery = z.infer<typeof listInventoryQuerySchema>;

/** `GET /api/v1/inventory/transactions` query string. */
export const listInventoryTransactionsQuerySchema = z.object({
  page: z.coerce
    .number({ error: "page must be an integer" })
    .int("page must be an integer")
    .min(1, "page must be at least 1")
    .default(1),
  limit: z.coerce
    .number({ error: "limit must be an integer" })
    .int("limit must be an integer")
    .min(1, "limit must be at least 1")
    .max(100, "limit must be at most 100")
    .default(20),
  productId: z.uuid("productId must be a valid UUID").optional(),
  from: z.iso.datetime("from must be a valid ISO 8601 date-time").optional(),
  to: z.iso.datetime("to must be a valid ISO 8601 date-time").optional(),
});

export type ListInventoryTransactionsQuery = z.infer<
  typeof listInventoryTransactionsQuerySchema
>;

const pageSchema = z.coerce
  .number({ error: "page must be an integer" })
  .int("page must be an integer")
  .min(1, "page must be at least 1")
  .default(1);

const limitSchema = z.coerce
  .number({ error: "limit must be an integer" })
  .int("limit must be an integer")
  .min(1, "limit must be at least 1")
  .max(100, "limit must be at most 100")
  .default(20);

/** `GET /api/v1/products` query string. */
export const listProductsQuerySchema = z.object({
  page: pageSchema,
  limit: limitSchema,
  search: z
    .string()
    .trim()
    .max(255, "search must be at most 255 characters")
    .optional()
    // An empty `?search=` is treated as "no filter" rather than a 0-length term.
    .transform((value) => (value === "" ? undefined : value)),
});

export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;
