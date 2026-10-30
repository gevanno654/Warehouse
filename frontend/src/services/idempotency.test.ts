/**
 * Idempotency-key generator tests.
 *
 * Keys must be unique per call and shaped as UUID v4, whether they come from
 * `crypto.randomUUID()` or the manual fallback.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { newIdempotencyKey } from "./idempotency.js";

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("newIdempotencyKey", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("mints unique UUID v4 keys", () => {
    const first = newIdempotencyKey();
    const second = newIdempotencyKey();

    expect(first).toMatch(UUID_V4);
    expect(second).toMatch(UUID_V4);
    expect(first).not.toBe(second);
  });

  it("falls back to a well-formed key without randomUUID", () => {
    const withoutRandomUUID = {
      ...globalThis.crypto,
      randomUUID: undefined,
      getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto),
    };
    vi.stubGlobal("crypto", withoutRandomUUID);

    expect(newIdempotencyKey()).toMatch(UUID_V4);
  });
});
