import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App.js";

function stubFetch(status: number): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response("{}", { status }))),
  );
}

describe("App shell", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the application title", async () => {
    stubFetch(200);

    render(<App />);

    expect(
      screen.getByRole("heading", { name: "Warehouse Receiving System", level: 1 }),
    ).toBeInTheDocument();

    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
  });

  it("reports a connected backend when readiness succeeds", async () => {
    stubFetch(200);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Backend: Connected");
    });
  });

  it("reports an unavailable backend when readiness returns 503", async () => {
    stubFetch(503);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Backend: Unavailable");
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "API is running but its database is unavailable.",
    );
  });

  it("reports an unavailable backend when the API cannot be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Backend: Unavailable");
    });
    expect(screen.getByRole("status")).toHaveTextContent("Cannot reach the API.");
  });

  it("links to the API documentation on the browser-facing base URL", async () => {
    stubFetch(200);

    render(<App />);

    expect(screen.getByRole("link", { name: "Swagger UI" })).toHaveAttribute(
      "href",
      "http://localhost:3000/docs",
    );

    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
  });

  it("does not render business screens", async () => {
    stubFetch(200);

    render(<App />);

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /sign in|log in/i })).not.toBeInTheDocument();

    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
  });
});
