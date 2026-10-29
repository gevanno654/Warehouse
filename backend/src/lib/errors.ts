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

export const serviceUnavailableError = (): AppError =>
  new AppError(
    503,
    "SERVICE_UNAVAILABLE",
    "A required dependency is unavailable.",
  );

export const internalError = (): AppError =>
  new AppError(500, "INTERNAL_ERROR", "An unexpected error occurred.");
