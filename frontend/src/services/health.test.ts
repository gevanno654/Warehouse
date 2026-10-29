import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { API_BASE_URL } from "../config.js";
import { fetchBackendStatus } from "./health.js";

/** Builds a fetch stub whose call count can be asserted. */
function stubFetchResponse(status: number) {
  const fetchMock = vi.fn(() => Promise.resolve(new Response("{}", { status })));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("fetchBackendStatus", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("queries the readiness endpoint on the browser-facing base URL", async () => {
    const fetchMock = stubFetchResponse(200);

    await fetchBackendStatus();

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE_URL}/ready`,
      expect.objectContaining({ method: "GET" }),
    );
    // Docker-internal hostnames must never reach the browser.
    expect(API_BASE_URL).not.toMatch(/(^|\/\/)(api|db)(:|\/|$)/);
  });

  it("maps a 200 readiness response to connected", async () => {
    stubFetchResponse(200);

    await expect(fetchBackendStatus()).resolves.toMatchObject({ status: "connected" });
  });

  it("maps a 503 readiness response to unavailable", async () => {
    stubFetchResponse(503);

    const result = await fetchBackendStatus();

    expect(result.status).toBe("unavailable");
    expect(result.detail).toBe("API is running but its database is unavailable.");
  });

  it("maps an unexpected status to unavailable without echoing the body", async () => {
    stubFetchResponse(500);

    const result = await fetchBackendStatus();

    expect(result.status).toBe("unavailable");
    expect(result.detail).toBe("API responded with status 500.");
  });

  it("maps a network failure to unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );

    await expect(fetchBackendStatus()).resolves.toMatchObject({
      status: "unavailable",
      detail: "Cannot reach the API.",
    });
  });

  it("maps an aborted request to unavailable", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new DOMException("Aborted", "AbortError"))),
    );

    controller.abort();

    await expect(fetchBackendStatus(controller.signal)).resolves.toMatchObject({
      status: "unavailable",
    });
  });
});
