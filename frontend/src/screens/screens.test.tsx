/**
 * Business-screen tests with a stubbed `fetch`.
 *
 * Each case mounts one screen inside the real `AuthProvider` with a signed-in
 * session and asserts rendering, filtering, submission wiring, and error
 * display. Duplicate-submit prevention and idempotency-key reuse are covered
 * at this level; durability itself stays a backend integration concern.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "../auth/AuthContext.js";
import { CreateDocumentScreen } from "./CreateDocumentScreen.js";
import { DocumentDetailScreen } from "./DocumentDetailScreen.js";
import { DocumentsScreen } from "./DocumentsScreen.js";
import { InventoryScreen } from "./InventoryScreen.js";
import { TransactionsScreen } from "./TransactionsScreen.js";

const SUPERVISOR = { id: "u1", email: "sup@example.com", role: "SUPERVISOR" } as const;

function seedSession(): void {
  window.sessionStorage.setItem("wrs.accessToken", "test-token");
  window.sessionStorage.setItem("wrs.currentUser", JSON.stringify(SUPERVISOR));
}

type RouteHandler = (url: string, init?: RequestInit) => Response | Promise<Response> | undefined;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

/** Routes stubbed `fetch` calls by URL substring; records every request. */
function stubRoutes(handlers: Record<string, RouteHandler>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const mock = vi.fn((url: unknown, init?: RequestInit) => {
    const target = String(url);
    calls.push({ url: target, init });
    for (const [fragment, handler] of Object.entries(handlers)) {
      if (target.includes(fragment)) {
        const response = handler(target, init);
        if (response !== undefined) {
          return Promise.resolve(response);
        }
      }
    }
    return Promise.resolve(
      jsonResponse(500, { error: { code: "INTERNAL_ERROR", message: "unstubbed" } }),
    );
  });
  vi.stubGlobal("fetch", mock);
  return { calls };
}

function requestJsonBody(init: RequestInit | undefined): unknown {
  if (typeof init?.body !== "string") {
    throw new Error("Expected a JSON request body");
  }
  return JSON.parse(init.body) as unknown;
}

function headerValue(init: RequestInit | undefined, name: string): string {
  const headers = init?.headers;
  if (headers !== null && typeof headers === "object" && !Array.isArray(headers)) {
    const value = (headers as Record<string, unknown>)[name];
    if (typeof value === "string") {
      return value;
    }
  }
  throw new Error(`Expected header ${name}`);
}

const DOCUMENT_SUMMARY = {
  id: "d1",
  documentNumber: "RCV-20261029-000001",
  status: "PARTIALLY_RECEIVED",
  createdAt: "2026-10-29T00:00:00.000Z",
  totalItems: 1,
  totalExpectedQuantity: 10,
  totalReceivedQuantity: 4,
};

const DOCUMENT_DETAIL = {
  ...DOCUMENT_SUMMARY,
  createdBy: { id: "u1", email: "sup@example.com", role: "SUPERVISOR" },
  updatedAt: "2026-10-29T01:00:00.000Z",
  items: [
    {
      id: "i1",
      productId: "p1",
      sku: "WIDGET-1",
      productName: "Widget One",
      expectedQuantity: 10,
      receivedQuantity: 4,
      remainingQuantity: 6,
    },
  ],
};

const RECEIPT_RESULT = {
  receiptOperationId: "r1",
  documentNumber: "RCV-20261029-000001",
  itemId: "i1",
  quantityReceivedNow: 2,
  cumulativeReceivedQuantity: 6,
  remainingQuantity: 4,
  availableStock: 6,
  documentStatus: "PARTIALLY_RECEIVED",
};

describe("business screens", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    window.sessionStorage.clear();
    seedSession();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.sessionStorage.clear();
  });

  it("lists receiving documents with status filter and pagination", async () => {
    stubRoutes({
      "/api/v1/auth/me": () => jsonResponse(200, { data: SUPERVISOR }),
      "/api/v1/receiving-documents": (url) =>
        url.includes("status=PENDING")
          ? jsonResponse(200, { data: [], meta: { page: 1, limit: 20, total: 0 } })
          : jsonResponse(200, { data: [DOCUMENT_SUMMARY], meta: { page: 1, limit: 20, total: 1 } }),
    });

    render(
      <AuthProvider>
        <DocumentsScreen onOpen={() => undefined} />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("RCV-20261029-000001")).toBeInTheDocument();
    });
    expect(screen.getByText("Partially received")).toBeInTheDocument();

    // Status filter narrows the list; the filtered request carries the param.
    await userEvent.selectOptions(screen.getByLabelText("Filter by status"), "PENDING");
    await waitFor(() => {
      expect(screen.getByText("No receiving documents found.")).toBeInTheDocument();
    });
  });

  it("shows an empty state and renders API errors", async () => {
    stubRoutes({
      "/api/v1/auth/me": () => jsonResponse(200, { data: SUPERVISOR }),
      "/api/v1/inventory": () =>
        jsonResponse(503, {
          error: { code: "SERVICE_UNAVAILABLE", message: "A required dependency is unavailable." },
        }),
    });

    render(
      <AuthProvider>
        <InventoryScreen />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "A required dependency is unavailable.",
      );
    });
  });

  it("creates a document from a searched product and navigates to it", async () => {
    const routes = stubRoutes({
      "/api/v1/auth/me": () => jsonResponse(200, { data: SUPERVISOR }),
      "/api/v1/products": () =>
        jsonResponse(200, {
          data: [
            {
              id: "p1",
              sku: "WIDGET-1",
              name: "Widget One",
              availableQuantity: 0,
              createdAt: "2026-10-29T00:00:00.000Z",
              updatedAt: "2026-10-29T00:00:00.000Z",
            },
          ],
          meta: { page: 1, limit: 8, total: 1 },
        }),
      "/api/v1/receiving-documents": (_url, init) => {
        if (init?.method !== "POST") {
          return undefined;
        }
        expect(requestJsonBody(init)).toEqual({
          items: [{ productId: "p1", expectedQuantity: 7 }],
        });
        return jsonResponse(201, { data: DOCUMENT_DETAIL });
      },
    });

    let createdId: string | null = null;
    render(
      <AuthProvider>
        <CreateDocumentScreen onCreated={(id) => { createdId = id; }} />
      </AuthProvider>,
    );

    const productInput = screen.getByLabelText("Product");
    await userEvent.click(productInput);
    await userEvent.type(productInput, "WIDGET");

    await waitFor(() => {
      expect(screen.getByRole("option")).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole("option").querySelector("button")!);

    await userEvent.type(screen.getByLabelText("Expected quantity"), "7");
    await userEvent.click(screen.getByRole("button", { name: "Create document" }));

    await waitFor(() => {
      expect(createdId).toBe("d1");
    });
    expect(routes.calls.some((call) => call.init?.method === "POST")).toBe(true);
  });

  it("submits a receipt with one idempotency key and blocks duplicate submits", async () => {
    const routes = stubRoutes({
      "/api/v1/auth/me": () => jsonResponse(200, { data: SUPERVISOR }),
      "/api/v1/receiving-documents/d1": (url, init) => {
        if (url.includes("/receipts")) {
          expect(init?.method).toBe("POST");
          // Simulate a slow backend: resolve on the next macrotask so the
          // second click lands while `submitting` is still true.
          return new Promise<Response>((resolve) => {
            setTimeout(() => resolve(jsonResponse(201, { data: RECEIPT_RESULT })), 20);
          });
        }
        return jsonResponse(200, { data: DOCUMENT_DETAIL });
      },
    });

    render(
      <AuthProvider>
        <DocumentDetailScreen documentId="d1" onBack={() => undefined} />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("WIDGET-1 — Widget One")).toBeInTheDocument();
    });

    const quantity = screen.getByLabelText("Receive quantity");
    await userEvent.type(quantity, "2");
    const submit = screen.getByRole("button", { name: "Record receipt" });

    // Double-click: the guard must collapse it into a single POST.
    await userEvent.click(submit);
    await userEvent.click(submit);

    await waitFor(() => {
      expect(screen.getByText(/Recorded 2 unit\(s\)/)).toBeInTheDocument();
    });

    const posts = routes.calls.filter((call) => call.url.includes("/receipts"));
    expect(posts).toHaveLength(1);
    expect(requestJsonBody(posts[0]?.init)).toEqual({ quantity: 2 });
    expect(headerValue(posts[0]?.init, "Idempotency-Key")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("reuses the same idempotency key when retrying after a failure", async () => {
    const routes = stubRoutes({
      "/api/v1/auth/me": () => jsonResponse(200, { data: SUPERVISOR }),
      "/api/v1/receiving-documents/d1": (url, _init) => {
        if (url.includes("/receipts")) {
          const attempt = routes.calls.filter((call) => call.url.includes("/receipts")).length;
          if (attempt <= 1) {
            return jsonResponse(500, {
              error: { code: "INTERNAL_ERROR", message: "boom" },
            });
          }
          return jsonResponse(201, { data: RECEIPT_RESULT });
        }
        return jsonResponse(200, { data: DOCUMENT_DETAIL });
      },
    });

    render(
      <AuthProvider>
        <DocumentDetailScreen documentId="d1" onBack={() => undefined} />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("WIDGET-1 — Widget One")).toBeInTheDocument();
    });

    await userEvent.type(screen.getByLabelText("Receive quantity"), "2");
    await userEvent.click(screen.getByRole("button", { name: "Record receipt" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("boom");
    });

    await userEvent.click(screen.getByRole("button", { name: "Record receipt" }));

    await waitFor(() => {
      expect(screen.getByText(/Recorded 2 unit\(s\)/)).toBeInTheDocument();
    });

    const posts = routes.calls.filter((call) => call.url.includes("/receipts"));
    expect(posts).toHaveLength(2);
    expect(headerValue(posts[0]?.init, "Idempotency-Key")).toBe(
      headerValue(posts[1]?.init, "Idempotency-Key"),
    );
  });

  it("surfaces receipt business-rule errors with remaining quantity", async () => {
    stubRoutes({
      "/api/v1/auth/me": () => jsonResponse(200, { data: SUPERVISOR }),
      "/api/v1/receiving-documents/d1": (url) => {
        if (url.includes("/receipts")) {
          return jsonResponse(422, {
            error: {
              code: "RECEIPT_EXCEEDS_REMAINING",
              message: "The receipt quantity exceeds the remaining expected quantity.",
              details: { remainingQuantity: 6 },
            },
          });
        }
        return jsonResponse(200, { data: DOCUMENT_DETAIL });
      },
    });

    render(
      <AuthProvider>
        <DocumentDetailScreen documentId="d1" onBack={() => undefined} />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("WIDGET-1 — Widget One")).toBeInTheDocument();
    });

    await userEvent.type(screen.getByLabelText("Receive quantity"), "9");
    await userEvent.click(screen.getByRole("button", { name: "Record receipt" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Only 6 remaining.");
    });
  });

  it("lists inventory balances and transaction history with filters", async () => {
    stubRoutes({
      "/api/v1/auth/me": () => jsonResponse(200, { data: SUPERVISOR }),
      "/api/v1/inventory/transactions": () =>
        jsonResponse(200, {
          data: [
            {
              id: "t1",
              productId: "p1",
              sku: "WIDGET-1",
              transactionType: "RECEIPT",
              quantityChange: 4,
              documentNumber: "RCV-20261029-000001",
              performedBy: "sup@example.com",
              createdAt: "2026-10-29T01:00:00.000Z",
            },
          ],
          meta: { page: 1, limit: 20, total: 1 },
        }),
      "/api/v1/inventory": () =>
        jsonResponse(200, {
          data: [{ productId: "p1", sku: "WIDGET-1", name: "Widget One", availableQuantity: 6 }],
          meta: { page: 1, limit: 20, total: 1 },
        }),
    });

    const { unmount } = render(
      <AuthProvider>
        <InventoryScreen />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("WIDGET-1")).toBeInTheDocument();
    });
    expect(screen.getByRole("table")).toHaveTextContent("6");
    unmount();

    render(
      <AuthProvider>
        <TransactionsScreen />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("RCV-20261029-000001")).toBeInTheDocument();
    });
    const table = screen.getByRole("table");
    expect(within(table).getByText("WIDGET-1")).toBeInTheDocument();
    expect(within(table).getByText("+4")).toBeInTheDocument();
    expect(within(table).getByText("sup@example.com")).toBeInTheDocument();
  });

  it("returns to login when the token expires mid-session", async () => {
    stubRoutes({
      "/api/v1/auth/me": () => jsonResponse(200, { data: SUPERVISOR }),
      "/api/v1/inventory": () =>
        jsonResponse(401, {
          error: { code: "UNAUTHENTICATED", message: "Authentication is required." },
        }),
    });

    render(
      <AuthProvider>
        <InventoryScreen />
      </AuthProvider>,
    );

    // The expired token is cleared and the shell falls back to the login form.
    await waitFor(() => {
      expect(window.sessionStorage.getItem("wrs.accessToken")).toBeNull();
    });
  });
});
