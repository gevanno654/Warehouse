import type { JSX } from "react";

import type { BackendStatusResult } from "../services/health.js";

const LABELS: Record<BackendStatusResult["status"], string> = {
  checking: "Checking",
  connected: "Connected",
  unavailable: "Unavailable",
};

export interface BackendStatusIndicatorProps {
  result: BackendStatusResult;
}

/**
 * Displays backend connectivity. Purely informational: authorization and
 * validation are enforced by the API, never by this indicator.
 */
export function BackendStatusIndicator({ result }: BackendStatusIndicatorProps): JSX.Element {
  return (
    <div className="status" data-status={result.status} role="status" aria-live="polite">
      <span className="status__dot" aria-hidden="true" />
      <span className="status__label">Backend: {LABELS[result.status]}</span>
      <span className="status__detail">{result.detail}</span>
    </div>
  );
}
