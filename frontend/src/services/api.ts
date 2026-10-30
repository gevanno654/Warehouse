/**
 * Typed client for the Warehouse Receiving System API.
 *
 * Every shape mirrors `docs/openapi.yaml`; request bodies, query parameters,
 * and the `{ data, meta }` / `{ error: { code, message, details } }` envelopes
 * are taken from the contract, never invented here. Business rules stay on the
 * backend — this module transports values and surfaces server errors.
 *
 * Secrets discipline: request bodies may contain a password (login only) and
 * headers carry the bearer token. Nothing here logs bodies, headers, or tokens.
 */
import { API_BASE_URL } from "../config.js";

export type UserRole = "OPERATOR" | "SUPERVISOR";
export type DocumentStatus = "PENDING" | "PARTIALLY_RECEIVED" | "COMPLETED";

export interface User {
  readonly id: string;
  readonly email: string;
  readonly role: UserRole;
}

export interface LoginResponse {
  readonly accessToken: string;
  readonly tokenType: "Bearer";
  readonly expiresIn: number;
  readonly user: User;
}

export interface Product {
  readonly id: string;
  readonly sku: string;
  readonly name: string;
  readonly availableQuantity: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ReceivingItem {
  readonly id: string;
  readonly productId: string;
  readonly sku: string;
  readonly productName: string;
  readonly expectedQuantity: number;
  readonly receivedQuantity: number;
  readonly remainingQuantity: number;
}

export interface ReceivingDocumentSummary {
  readonly id: string;
  readonly documentNumber: string;
  readonly status: DocumentStatus;
  readonly createdAt: string;
  readonly totalItems: number;
  readonly totalExpectedQuantity: number;
  readonly totalReceivedQuantity: number;
}

export interface ReceivingDocument extends ReceivingDocumentSummary {
  readonly createdBy: User;
  readonly updatedAt: string;
  readonly items: readonly ReceivingItem[];
}

export interface ReceiptResult {
  readonly receiptOperationId: string;
  readonly documentNumber: string;
  readonly itemId: string;
  readonly quantityReceivedNow: number;
  readonly cumulativeReceivedQuantity: number;
  readonly remainingQuantity: number;
  readonly availableStock: number;
  readonly documentStatus: DocumentStatus;
}

export interface InventoryItem {
  readonly productId: string;
  readonly sku: string;
  readonly name: string;
  readonly availableQuantity: number;
}

export interface InventoryTransaction {
  readonly id: string;
  readonly productId: string;
  readonly sku: string;
  readonly transactionType: "RECEIPT";
  readonly quantityChange: number;
  readonly documentNumber: string;
  readonly performedBy: string;
  readonly createdAt: string;
}

export interface PageMeta {
  readonly page: number;
  readonly limit: number;
  readonly total: number;
}

/** Stable error codes from `ErrorCode` in `docs/openapi.yaml`. */
export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "IDEMPOTENCY_KEY_REQUIRED"
  | "IDEMPOTENCY_KEY_CONFLICT"
  | "DUPLICATE_SKU"
  | "DUPLICATE_DOCUMENT_ITEM"
  | "INVALID_QUANTITY"
  | "RECEIPT_EXCEEDS_REMAINING"
  | "DOCUMENT_ALREADY_COMPLETED"
  | "INTERNAL_ERROR"
  | "SERVICE_UNAVAILABLE";

/** Transport-independent API failure, mirroring the backend `AppError` shape. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(status: number, code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details =
      details !== null && typeof details === "object"
        ? (details as Record<string, unknown>)
        : undefined;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/**
 * Message safe to render. The contract guarantees `error.message` is
 * human-readable; `error.code` is stable for branching, never for display.
 */
export function userFacingMessage(error: unknown): string {
  if (isApiError(error)) {
    if (error.code === "RECEIPT_EXCEEDS_REMAINING") {
      const remaining = (error.details?.["remainingQuantity"] as number | undefined) ?? null;
      return remaining === null
        ? error.message
        : `${error.message} Only ${remaining} remaining.`;
    }
    return error.message;
  }
  return "Something went wrong. Please try again.";
}

export interface RequestOptions {
  readonly token?: string;
  readonly method?: "GET" | "POST";
  readonly body?: unknown;
  /** Sent verbatim as the `Idempotency-Key` header for receipt submissions. */
  readonly idempotencyKey?: string;
  readonly signal?: AbortSignal;
}

function errorCodeFromBody(body: unknown): ErrorCode {
  const code =
    typeof body === "object" && body !== null && "error" in body
      ? (body as { error?: { code?: unknown } }).error?.code
      : undefined;
  return typeof code === "string" ? (code as ErrorCode) : "INTERNAL_ERROR";
}

function errorMessageFromBody(body: unknown, fallback: string): string {
  const message =
    typeof body === "object" && body !== null && "error" in body
      ? (body as { error?: { message?: unknown } }).error?.message
      : undefined;
  return typeof message === "string" && message.length > 0 ? message : fallback;
}

function errorDetailsFromBody(body: unknown): unknown {
  if (typeof body === "object" && body !== null && "error" in body) {
    return (body as { error?: { details?: unknown } }).error?.details;
  }
  return undefined;
}

/**
 * Parses one API response. Success envelopes carry `{ data }` (lists add
 * `{ meta }`); failure envelopes carry `{ error: { code, message } }`.
 *
 * A `401` here means the token is missing, invalid, or expired — callers treat
 * it as "return to the login flow", never as a field-level error.
 */
export async function apiFetch<T>(
  path: string,
  options: RequestOptions = {},
): Promise<{ data: T; meta?: PageMeta }> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? "GET",
      headers: {
        Accept: "application/json",
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(options.token === undefined ? {} : { Authorization: `Bearer ${options.token}` }),
        ...(options.idempotencyKey === undefined
          ? {}
          : { "Idempotency-Key": options.idempotencyKey }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch {
    throw new ApiError(0, "SERVICE_UNAVAILABLE", "Cannot reach the API. Check your connection.");
  }

  let body: unknown;
  try {
    body = (await response.json()) as unknown;
  } catch {
    body = null;
  }

  if (!response.ok) {
    throw new ApiError(
      response.status,
      errorCodeFromBody(body),
      errorMessageFromBody(body, `Request failed with status ${response.status}.`),
      errorDetailsFromBody(body),
    );
  }

  if (typeof body !== "object" || body === null || !("data" in body)) {
    throw new ApiError(response.status, "INTERNAL_ERROR", "The API returned an unexpected response.");
  }

  const { data } = body as { data: T };
  const meta =
    "meta" in body && typeof body.meta === "object" && body.meta !== null
      ? (body.meta as PageMeta)
      : undefined;
  return { data, meta };
}

/** `true` for the expired/invalid-token signal that must end the session. */
export function isSessionExpired(error: unknown): boolean {
  return isApiError(error) && error.status === 401;
}

export interface LoginInput {
  readonly email: string;
  readonly password: string;
}

/** `POST /api/v1/auth/login` — the only call that carries a password. */
export async function login(input: LoginInput): Promise<LoginResponse> {
  const { data } = await apiFetch<LoginResponse>("/api/v1/auth/login", {
    method: "POST",
    body: { email: input.email.trim(), password: input.password },
  });
  return data;
}

/** `GET /api/v1/auth/me` — validates a stored token on app boot. */
export async function getCurrentUser(token: string): Promise<User> {
  const { data } = await apiFetch<User>("/api/v1/auth/me", { token });
  return data;
}

export interface ListProductsInput {
  readonly token: string;
  readonly page?: number;
  readonly limit?: number;
  readonly search?: string;
}

export async function listProducts(
  input: ListProductsInput,
): Promise<{ products: readonly Product[]; meta: PageMeta }> {
  const params = new URLSearchParams();
  if (input.page !== undefined) params.set("page", String(input.page));
  if (input.limit !== undefined) params.set("limit", String(input.limit));
  if (input.search !== undefined && input.search.trim() !== "") {
    params.set("search", input.search.trim());
  }
  const query = params.size > 0 ? `?${params.toString()}` : "";
  const { data, meta } = await apiFetch<readonly Product[]>(`/api/v1/products${query}`, {
    token: input.token,
  });
  return { products: data, meta: meta ?? { page: 1, limit: data.length, total: data.length } };
}

export interface CreateProductInput {
  readonly sku: string;
  readonly name: string;
}

/**
 * `POST /api/v1/products` — supervisor only. The backend trims both fields,
 * normalises the SKU to upper case, and creates the zero-stock inventory row
 * atomically. `403 FORBIDDEN` for operators and `409 DUPLICATE_SKU` surface
 * as `ApiError`s for the form to display.
 */
export async function createProduct(token: string, input: CreateProductInput): Promise<Product> {
  const { data } = await apiFetch<Product>("/api/v1/products", {
    method: "POST",
    token,
    body: { sku: input.sku, name: input.name },
  });
  return data;
}

export interface ListDocumentsInput {
  readonly token: string;
  readonly page?: number;
  readonly limit?: number;
  readonly status?: DocumentStatus | "";
  readonly search?: string;
}

export async function listDocuments(
  input: ListDocumentsInput,
): Promise<{ documents: readonly ReceivingDocumentSummary[]; meta: PageMeta }> {
  const params = new URLSearchParams();
  if (input.page !== undefined) params.set("page", String(input.page));
  if (input.limit !== undefined) params.set("limit", String(input.limit));
  if (input.status !== undefined && input.status !== "") params.set("status", input.status);
  if (input.search !== undefined && input.search.trim() !== "") {
    params.set("search", input.search.trim());
  }
  const query = params.size > 0 ? `?${params.toString()}` : "";
  const { data, meta } = await apiFetch<readonly ReceivingDocumentSummary[]>(
    `/api/v1/receiving-documents${query}`,
    { token: input.token },
  );
  return {
    documents: data,
    meta: meta ?? { page: 1, limit: data.length, total: data.length },
  };
}

export async function getDocument(token: string, id: string): Promise<ReceivingDocument> {
  const { data } = await apiFetch<ReceivingDocument>(`/api/v1/receiving-documents/${id}`, {
    token,
  });
  return data;
}

export interface NewDocumentItem {
  readonly productId: string;
  readonly expectedQuantity: number;
}

/**
 * `POST /api/v1/receiving-documents`. The backend generates the document
 * number and derives the initial `PENDING` status; the client only supplies
 * items. Duplicate-product and unknown-product rejections surface as `409` /
 * `404` `ApiError`s for the form to display.
 */
export async function createDocument(
  token: string,
  items: readonly NewDocumentItem[],
): Promise<ReceivingDocument> {
  const { data } = await apiFetch<ReceivingDocument>("/api/v1/receiving-documents", {
    method: "POST",
    token,
    body: { items: items.map((item) => ({ ...item })) },
  });
  return data;
}

export interface RecordReceiptInput {
  readonly token: string;
  readonly documentId: string;
  readonly itemId: string;
  readonly quantity: number;
  /** One key per logical receipt operation; retries reuse it verbatim. */
  readonly idempotencyKey: string;
}

/**
 * `POST .../items/{itemId}/receipts`. Success is only known when this resolves:
 * the UI must not imply a receipt landed before the API confirms it.
 */
export async function recordReceipt(input: RecordReceiptInput): Promise<ReceiptResult> {
  const { data } = await apiFetch<ReceiptResult>(
    `/api/v1/receiving-documents/${input.documentId}/items/${input.itemId}/receipts`,
    {
      method: "POST",
      token: input.token,
      body: { quantity: input.quantity },
      idempotencyKey: input.idempotencyKey,
    },
  );
  return data;
}

export interface ListInventoryInput {
  readonly token: string;
  readonly page?: number;
  readonly limit?: number;
  readonly search?: string;
}

export async function listInventory(
  input: ListInventoryInput,
): Promise<{ items: readonly InventoryItem[]; meta: PageMeta }> {
  const params = new URLSearchParams();
  if (input.page !== undefined) params.set("page", String(input.page));
  if (input.limit !== undefined) params.set("limit", String(input.limit));
  if (input.search !== undefined && input.search.trim() !== "") {
    params.set("search", input.search.trim());
  }
  const query = params.size > 0 ? `?${params.toString()}` : "";
  const { data, meta } = await apiFetch<readonly InventoryItem[]>(`/api/v1/inventory${query}`, {
    token: input.token,
  });
  return { items: data, meta: meta ?? { page: 1, limit: data.length, total: data.length } };
}

export interface ListTransactionsInput {
  readonly token: string;
  readonly page?: number;
  readonly limit?: number;
  /** UUID of one product; the backend rejects malformed values with `400`. */
  readonly productId?: string;
  /** Inclusive ISO 8601 bounds, e.g. `2026-10-29T00:00:00.000Z`. */
  readonly from?: string;
  readonly to?: string;
}

export async function listTransactions(
  input: ListTransactionsInput,
): Promise<{ transactions: readonly InventoryTransaction[]; meta: PageMeta }> {
  const params = new URLSearchParams();
  if (input.page !== undefined) params.set("page", String(input.page));
  if (input.limit !== undefined) params.set("limit", String(input.limit));
  if (input.productId !== undefined && input.productId.trim() !== "") {
    params.set("productId", input.productId.trim());
  }
  if (input.from !== undefined && input.from.trim() !== "") {
    params.set("from", input.from.trim());
  }
  if (input.to !== undefined && input.to.trim() !== "") {
    params.set("to", input.to.trim());
  }
  const query = params.size > 0 ? `?${params.toString()}` : "";
  const { data, meta } = await apiFetch<readonly InventoryTransaction[]>(
    `/api/v1/inventory/transactions${query}`,
    { token: input.token },
  );
  return {
    transactions: data,
    meta: meta ?? { page: 1, limit: data.length, total: data.length },
  };
}
