/**
 * Auth flow tests: login success/failure and stored-session handling.
 *
 * `fetch` is stubbed, so these prove the UI behaviour (session state,
 * storage writes, expiry handling) — not backend integration.
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import { useState, type JSX } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthProvider, useAuth } from "./AuthContext.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

function stubFetchOnce(status: number, body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(jsonResponse(status, body))),
  );
}

const VALID_LOGIN = {
  data: {
    accessToken: "tok-1",
    tokenType: "Bearer",
    expiresIn: 3600,
    user: { id: "u1", email: "op@example.com", role: "OPERATOR" },
  },
};

function Probe({ onState }: { onState: (email: string | null) => void }): null {
  const auth = useAuth();
  onState(auth.user?.email ?? null);
  return null;
}

describe("AuthProvider", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.sessionStorage.clear();
  });

  it("signs in and persists the session", async () => {
    stubFetchOnce(200, VALID_LOGIN);
    const seen: Array<string | null> = [];

    function SignIn(): null {
      const auth = useAuth();
      const [started, setStarted] = useState(false);
      if (!started) {
        setStarted(true);
        void auth.signIn("op@example.com", "secret");
      }
      return null;
    }

    render(
      <AuthProvider>
        <SignIn />
        <Probe onState={(email) => seen.push(email)} />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(window.sessionStorage.getItem("wrs.accessToken")).toBe("tok-1");
    });
    expect(seen).toContain("op@example.com");
    expect(JSON.parse(window.sessionStorage.getItem("wrs.currentUser") ?? "{}")).toEqual({
      id: "u1",
      email: "op@example.com",
      role: "OPERATOR",
    });
  });

  it("surfaces invalid credentials without signing in", async () => {
    stubFetchOnce(
      401,
      { error: { code: "UNAUTHENTICATED", message: "Invalid email or password." } },
    );

    function Attempt(): JSX.Element {
      const auth = useAuth();
      const [message, setMessage] = useState<string | null>(null);
      const [started, setStarted] = useState(false);
      if (!started) {
        setStarted(true);
        auth.signIn("op@example.com", "wrong").catch((error: unknown) => {
          setMessage(error instanceof Error ? error.message : "failed");
        });
      }
      return message === null ? <p>pending</p> : <p role="alert">{message}</p>;
    }

    render(
      <AuthProvider>
        <Attempt />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Invalid email or password.");
    });
    expect(window.sessionStorage.getItem("wrs.accessToken")).toBeNull();
  });

  it("drops a stored token the backend rejects and starts signed out", async () => {
    window.sessionStorage.setItem("wrs.accessToken", "stale-token");
    window.sessionStorage.setItem(
      "wrs.currentUser",
      JSON.stringify({ id: "u1", email: "op@example.com", role: "OPERATOR" }),
    );
    stubFetchOnce(
      401,
      { error: { code: "UNAUTHENTICATED", message: "Authentication is required." } },
    );

    const seen: Array<string | null> = [];
    render(
      <AuthProvider>
        <Probe onState={(email) => seen.push(email)} />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(window.sessionStorage.getItem("wrs.accessToken")).toBeNull();
    });
    expect(seen[seen.length - 1]).toBeNull();
  });

  it("restores a valid stored session without a login round-trip", async () => {
    window.sessionStorage.setItem("wrs.accessToken", "good-token");
    window.sessionStorage.setItem(
      "wrs.currentUser",
      JSON.stringify({ id: "u1", email: "op@example.com", role: "OPERATOR" }),
    );
    stubFetchOnce(200, {
      data: { id: "u1", email: "op@example.com", role: "OPERATOR" },
    });

    let latest: string | null = null;
    render(
      <AuthProvider>
        <Probe
          onState={(email) => {
            latest = email;
          }}
        />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(latest).toBe("op@example.com");
    });
    await act(() => Promise.resolve());
  });
});
