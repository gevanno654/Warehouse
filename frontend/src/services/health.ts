import { API_BASE_URL } from "../config.js";

export type BackendStatus = "checking" | "connected" | "unavailable";

export interface BackendStatusResult {
  status: BackendStatus;
  /** Human-readable summary safe to render. Never contains raw error output. */
  detail: string;
}

const READINESS_TIMEOUT_MS = 5_000;

/**
 * Queries the API readiness endpoint.
 *
 * Readiness (not liveness) is used because the indicator reports whether the
 * system the browser talks to is actually able to serve requests.
 *
 * @param signal - optional abort signal, used to cancel on unmount.
 */
export async function fetchBackendStatus(signal?: AbortSignal): Promise<BackendStatusResult> {
  const timeout = AbortSignal.timeout(READINESS_TIMEOUT_MS);
  const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout]);

  try {
    const response = await fetch(`${API_BASE_URL}/ready`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: combined,
    });

    if (response.ok) {
      return { status: "connected", detail: "API and database reachable." };
    }

    if (response.status === 503) {
      return { status: "unavailable", detail: "API is running but its database is unavailable." };
    }

    return { status: "unavailable", detail: `API responded with status ${response.status}.` };
  } catch {
    // Network failures, CORS rejections, and timeouts are all reported the
    // same way; the console message is enough for diagnosis.
    return { status: "unavailable", detail: "Cannot reach the API." };
  }
}
