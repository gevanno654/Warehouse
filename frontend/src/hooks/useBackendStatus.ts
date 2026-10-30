import { useEffect, useState } from "react";

import { fetchBackendStatus, type BackendStatusResult } from "../services/health.js";

const INITIAL: BackendStatusResult = {
  status: "checking",
  detail: "Checking backend connectivity…",
};

/**
 * Tracks backend connectivity for the shell status indicator.
 *
 * The request is aborted on unmount so React StrictMode's double effect cannot
 * leave a stray fetch behind.
 */
export function useBackendStatus(): BackendStatusResult {
  const [result, setResult] = useState<BackendStatusResult>(INITIAL);

  useEffect(() => {
    const controller = new AbortController();

    void fetchBackendStatus(controller.signal).then((next) => {
      if (!controller.signal.aborted) {
        setResult(next);
      }
    });

    return () => controller.abort();
  }, []);

  return result;
}
