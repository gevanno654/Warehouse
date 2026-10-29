/**
 * API client tests with a stubbed `fetch`.
 *
 * These are contract-shape tests: envelopes, error mapping, header wiring,
 * and request bodies. They prove the client speaks the documented protocol;
 * they are not backend integration tests (no real database is involved).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { API_BASE_URL } from "../config.js";
import {
  ApiError,
  apiFetch,
  createDocument,
  getCurrentUser,
  isApiError,
  isSessionExpired,
  listDocuments,
  listInventory,
  listTransactions,
  login,
  recordReceipt,
  userFacingMessage,
} from "./api.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const mock = vi.fn((url: unknown, init?: RequestInit) => handler(String(url), init));
  vi.stubGlobal("fetch", mock);
  return mock;
}

type FetchCall = readonly [url: string, init?: RequestInit];

function firstCall(mock: ReturnType<typeof stubFetch>): FetchCall {
  const call = mock.mock.calls[0];
  if (call === undefined || typeof call[0] !== "string") {
    throw new Error("Expected fetch to have been called");
  }
  return [call[0], call[1]];
}

function requestBody(init: RequestInit | undefined): unknown {
  if (typeof init?.body !== "string") {
    throw new Error("Expected a JSON request body");
  }
  return JSON.parse(init.body) as unknown;
}

describe("apiFetch", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the bearer token and unwraps the data envelope", async () => {
    const mock = stubFetch(() => jsonResponse(200, { data: { id: "u1" } }));

    const result = await apiFetch<{ id: string }>("/api/v1/auth/me", { token: "tok" });

    expect(mock).toHaveBeenCalledOnce();
    const [, init] = firstCall(mock);
    expect(init?.headers).toMatchObject({ Authorization: "Bearer tok" });
    expect(result).toEqual({ data: { id: "u1" }, meta: undefined });
  });

  it("returns pagination meta when present", async () => {
    stubFetch(() =>
      jsonResponse(200, { data: [], meta: { page: 2, limit: 20, total: 41 } }),
    );

    const result = await apiFetch<unknown[]>("/api/v1/receiving-documents", {});

    expect(result.meta).toEqual({ page: 2, limit: 20, total: 41 });
  });

  it("maps a 401 to UNAUTHENTICATED and flags session expiry", async () => {
    stubFetch(() =>
      jsonResponse(401, { error: { code: "UNAUTHENTICATED", message: "Authentication is required." } }),
    );

    const failure: unknown = await apiFetch("/api/v1/auth/me", {}).catch((error: unknown) => error);

    expect(isApiError(failure)).toBe(true);
    expect(isSessionExpired(failure)).toBe(true);
    expect(failure).toBeInstanceOf(ApiError);
    if (failure instanceof ApiError) {
      expect(failure.code).toBe("UNAUTHENTICATED");
    }
  });

  it("keeps receipt business-rule details for the UI", async () => {
    stubFetch(() =>
      jsonResponse(422, {
        error: {
          code: "RECEIPT_EXCEEDS_REMAINING",
          message: "The receipt quantity exceeds the remaining expected quantity.",
          details: { remainingQuantity: 4 },
        },
      }),
    );

    const failure = await apiFetch("/x", { method: "POST" }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    if (failure instanceof ApiError) {
      expect(failure.code).toBe("RECEIPT_EXCEEDS_REMAINING");
    }
    expect(userFacingMessage(failure)).toContain("Only 4 remaining.");
  });

  it("maps network failures to a connection error without a status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );

    const failure = await apiFetch("/api/v1/inventory", {}).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    if (failure instanceof ApiError) {
      expect(failure.code).toBe("SERVICE_UNAVAILABLE");
    }
    expect(userFacingMessage(failure)).toContain("Cannot reach the API");
  });

  it("rejects a success response without a data envelope", async () => {
    stubFetch(() => jsonResponse(200, { unexpected: true }));

    const failure = await apiFetch("/api/v1/inventory", {}).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    if (failure instanceof ApiError) {
      expect(failure.code).toBe("INTERNAL_ERROR");
    }
  });
});

describe("endpoint wiring", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("logs in against the browser-facing base URL with email and password", async () => {
    const mock = stubFetch(() =>
      jsonResponse(200, {
        data: {
          accessToken: "tok",
          tokenType: "Bearer",
          expiresIn: 3600,
          user: { id: "u1", email: "op@example.com", role: "OPERATOR" },
        },
      }),
    );

    const result = await login({ email: "  Op@Example.com ", password: "secret" });

    expect(mock).toHaveBeenCalledOnce();
    const [url, init] = firstCall(mock);
    expect(url).toBe(`${API_BASE_URL}/api/v1/auth/login`);
    expect(init?.method).toBe("POST");
    expect(requestBody(init)).toEqual({ email: "Op@Example.com", password: "secret" });
    expect(result.user.role).toBe("OPERATOR");
  });

  it("validates a stored token with GET /api/v1/auth/me", async () => {
    stubFetch(() =>
      jsonResponse(200, { data: { id: "u1", email: "op@example.com", role: "OPERATOR" } }),
    );

    await expect(getCurrentUser("tok")).resolves.toEqual({
      id: "u1",
      email: "op@example.com",
      role: "OPERATOR",
    });
  });

  it("lists documents with status, search, and pagination params", async () => {
    const mock = stubFetch(() =>
      jsonResponse(200, { data: [], meta: { page: 1, limit: 20, total: 0 } }),
    );

    await listDocuments({ token: "tok", status: "PENDING", search: "RCV-1", page: 1, limit: 20 });

    const [url] = firstCall(mock);
    expect(url).toContain("/api/v1/receiving-documents?");
    expect(url).toContain("status=PENDING");
    expect(url).toContain("search=RCV-1");
  });

  it("creates a document with the items array and no client-side number", async () => {
    const mock = stubFetch(() =>
      jsonResponse(201, {
        data: {
          id: "d1",
          documentNumber: "RCV-20261029-000001",
          status: "PENDING",
          createdBy: { id: "u1", email: "op@example.com", role: "OPERATOR" },
          createdAt: "2026-10-29T00:00:00.000Z",
          updatedAt: "2026-10-29T00:00:00.000Z",
          totalItems: 1,
          totalExpectedQuantity: 5,
          totalReceivedQuantity: 0,
          items: [],
        },
      }),
    );

    await createDocument("tok", [{ productId: "p1", expectedQuantity: 5 }]);

    const [, init] = firstCall(mock);
    expect(requestBody(init)).toEqual({
      items: [{ productId: "p1", expectedQuantity: 5 }],
    });
  });

  it("records a receipt with quantity body and verbatim Idempotency-Key", async () => {
    const mock = stubFetch(() =>
      jsonResponse(201, {
        data: {
          receiptOperationId: "r1",
          documentNumber: "RCV-1",
          itemId: "i1",
          quantityReceivedNow: 3,
          cumulativeReceivedQuantity: 3,
          remainingQuantity: 7,
          availableStock: 3,
          documentStatus: "PARTIALLY_RECEIVED",
        },
      }),
    );

    await recordReceipt({
      token: "tok",
      documentId: "d1",
      itemId: "i1",
      quantity: 3,
      idempotencyKey: "key-123",
    });

    const [url, init] = firstCall(mock);
    expect(url).toBe(`${API_BASE_URL}/api/v1/receiving-documents/d1/items/i1/receipts`);
    expect(requestBody(init)).toEqual({ quantity: 3 });
    expect(init?.headers).toMatchObject({ "Idempotency-Key": "key-123" });
  });

  it("lists inventory and transactions against the documented paths", async () => {
    const mock = stubFetch((url) => {
      if (String(url).includes("/transactions")) {
        return jsonResponse(200, { data: [], meta: { page: 1, limit: 20, total: 0 } });
      }
      return jsonResponse(200, { data: [], meta: { page: 1, limit: 20, total: 0 } });
    });

    await listInventory({ token: "tok", search: "WIDGET" });
    await listTransactions({ token: "tok", from: "2026-10-01T00:00:00.000Z" });

    const urls = mock.mock.calls.map(([url]) => String(url));
    expect(urls[0]).toContain("/api/v1/inventory?search=WIDGET");
    expect(urls[1]).toContain("/api/v1/inventory/transactions?");
    expect(urls[1]).toContain("from=2026-10-01");
  });
});
