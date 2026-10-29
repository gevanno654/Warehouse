/**
 * Stable error codes defined by `docs/openapi.yaml` (`components.schemas.ErrorCode`).
 *
 * Keep this list in sync with the contract. A code that is not in the contract
 * must not be returned to a client.
 */
export const ERROR_CODES = [
  "VALIDATION_ERROR",
  "INVALID_QUANTITY",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "DUPLICATE_SKU",
  "DUPLICATE_DOCUMENT_ITEM",
  "IDEMPOTENCY_KEY_REQUIRED",
  "IDEMPOTENCY_KEY_CONFLICT",
  "RECEIPT_EXCEEDS_REMAINING",
  "DOCUMENT_ALREADY_COMPLETED",
  "INTERNAL_ERROR",
  "SERVICE_UNAVAILABLE",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ErrorDetails {
  readonly [key: string]: unknown;
}

/**
 * Transport-independent application error.
 *
 * `message` is sent to the client, so it must never contain implementation
 * details, credentials, or internal identifiers beyond resource references.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details: ErrorDetails | undefined;

  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    details?: ErrorDetails,
  ) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const notFoundError = (): AppError =>
  new AppError(404, "NOT_FOUND", "The requested resource does not exist.");

/**
 * Authentication failure.
 *
 * The message is deliberately generic and identical for a missing token, an
 * invalid token, and bad credentials, so it never reveals whether an account
 * exists.
 */
export const unauthenticatedError = (): AppError =>
  new AppError(401, "UNAUTHENTICATED", "Authentication is required.");

export const invalidCredentialsError = (): AppError =>
  new AppError(401, "UNAUTHENTICATED", "Invalid email or password.");

export const forbiddenError = (): AppError =>
  new AppError(403, "FORBIDDEN", "Your role is not permitted to perform this operation.");

export const duplicateSkuError = (): AppError =>
  new AppError(409, "DUPLICATE_SKU", "A product with this SKU already exists.");

export const duplicateDocumentItemError = (): AppError =>
  new AppError(
    409,
    "DUPLICATE_DOCUMENT_ITEM",
    "A product may appear only once in a receiving document.",
  );

export const idempotencyKeyRequiredError = (): AppError =>
  new AppError(
    400,
    "IDEMPOTENCY_KEY_REQUIRED",
    "The Idempotency-Key header is required for receipt requests.",
  );

export const idempotencyKeyConflictError = (): AppError =>
  new AppError(
    409,
    "IDEMPOTENCY_KEY_CONFLICT",
    "This Idempotency-Key was already used for a different request.",
  );

export const invalidQuantityError = (): AppError =>
  new AppError(400, "INVALID_QUANTITY", "The quantity must be a positive integer.");

/** A referenced product does not exist (document creation). */
export const productsNotFoundError = (): AppError =>
  new AppError(404, "NOT_FOUND", "One or more referenced products do not exist.");

/** The document, the item, or their association does not exist (receipts). */
export const receivingNotFoundError = (): AppError =>
  new AppError(404, "NOT_FOUND", "Receiving document or item not found.");

export const receiptExceedsRemainingError = (remainingQuantity: number): AppError =>
  new AppError(
    422,
    "RECEIPT_EXCEEDS_REMAINING",
    "The receipt quantity exceeds the remaining expected quantity.",
    { remainingQuantity },
  );

export const documentAlreadyCompletedError = (): AppError =>
  new AppError(
    422,
    "DOCUMENT_ALREADY_COMPLETED",
    "Completed receiving documents cannot accept additional receipts.",
  );

export const serviceUnavailableError = (): AppError =>
  new AppError(
    503,
    "SERVICE_UNAVAILABLE",
    "A required dependency is unavailable.",
  );

export const internalError = (): AppError =>
  new AppError(500, "INTERNAL_ERROR", "An unexpected error occurred.");
