/**
 * Application shell tests with a stubbed `fetch`.
 *
 * Signed-out users see the login form; signed-in users (stubbed `/auth/me`
 * success) see the nav and the document list. Backend connectivity still
 * surfaces through the status indicator in both states.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

function stubFetch(handler: (url: string) => Response): void {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: unknown) => Promise.resolve(handler(String(url)))),
  );
}

const SUPERVISOR = { id: "u1", email: "sup@example.com", role: "SUPERVISOR" } as const;

describe("App shell", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    window.sessionStorage.clear();
    window.location.hash = "";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.sessionStorage.clear();
    window.location.hash = "";
  });

  it("renders the login form when signed out", async () => {
    stubFetch((url) =>
      url.endsWith("/ready") ? jsonResponse(200, {}) : jsonResponse(401, {}),
    );

    render(<App />);

    expect(
      screen.getByRole("heading", { name: "Warehouse Receiving System", level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sign in", level: 2 })).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();

    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
  });

  it("reports an unavailable backend while signed out", async () => {
    stubFetch((url) =>
      url.endsWith("/ready")
        ? jsonResponse(503, {})
        : jsonResponse(401, {}),
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Backend: Unavailable");
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "API is running but its database is unavailable.",
    );
  });

  it("shows the business shell when the stored session validates", async () => {
    window.sessionStorage.setItem("wrs.accessToken", "good-token");
    window.sessionStorage.setItem("wrs.currentUser", JSON.stringify(SUPERVISOR));
    stubFetch((url) => {
      if (url.endsWith("/ready")) {
        return jsonResponse(200, {});
      }
      if (url.endsWith("/api/v1/auth/me")) {
        return jsonResponse(200, { data: SUPERVISOR });
      }
      return jsonResponse(200, { data: [], meta: { page: 1, limit: 20, total: 0 } });
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
    });
    expect(screen.getByRole("link", { name: "Documents" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Inventory" })).toBeInTheDocument();
    expect(screen.getByText("sup@example.com · SUPERVISOR")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Sign in" })).not.toBeInTheDocument();
  });

  it("returns to login when the stored session is rejected", async () => {
    window.sessionStorage.setItem("wrs.accessToken", "stale-token");
    window.sessionStorage.setItem("wrs.currentUser", JSON.stringify(SUPERVISOR));
    stubFetch((url) =>
      url.endsWith("/ready")
        ? jsonResponse(200, {})
        : jsonResponse(401, {
            error: { code: "UNAUTHENTICATED", message: "Authentication is required." },
          }),
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Sign in", level: 2 })).toBeInTheDocument();
    });
  });

  it("hides document creation for operators but keeps it for supervisors", async () => {
    const operator = { id: "u2", email: "op@example.com", role: "OPERATOR" } as const;
    window.sessionStorage.setItem("wrs.accessToken", "op-token");
    window.sessionStorage.setItem("wrs.currentUser", JSON.stringify(operator));
    stubFetch((url) => {
      if (url.endsWith("/ready")) {
        return jsonResponse(200, {});
      }
      if (url.endsWith("/api/v1/auth/me")) {
        return jsonResponse(200, { data: operator });
      }
      return jsonResponse(200, { data: [], meta: { page: 1, limit: 20, total: 0 } });
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
    });
    expect(screen.queryByRole("link", { name: "New document" })).not.toBeInTheDocument();
    expect(screen.getByText("op@example.com · OPERATOR")).toBeInTheDocument();
  });
});
