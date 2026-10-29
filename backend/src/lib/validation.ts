/**
 * Request validation.
 *
 * Every schema failure is a `400 VALIDATION_ERROR` per
 * `docs/openapi.yaml` and `docs/technical-spec.md` §5. Schemas are derived from
 * the approved contract; limits are copied from `docs/openapi.yaml` rather than
 * chosen here.
 */
import { z } from "zod";

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
