/**
 * Idempotency keys for receipt submissions.
 *
 * Contract (`docs/openapi.yaml`): one key identifies one *logical* receipt
 * operation. A fresh key is minted when the operator starts a submission; the
 * same key is retained across automatic or manual retries of that submission
 * so the backend replays instead of double-applying. A different quantity,
 * item, or document is a different operation and always gets a fresh key.
 *
 * UUID v4 from `crypto.randomUUID()` is the recommended form. The fallback
 * below is only for non-secure contexts (plain HTTP on old browsers); it still
 * yields a unique 128-bit value, just with weaker randomness.
 */
export function newIdempotencyKey(): string {
  const cryptoRef =
    typeof globalThis.crypto === "object" && globalThis.crypto !== null
      ? (globalThis.crypto as Crypto & { randomUUID?: () => string })
      : undefined;

  if (cryptoRef?.randomUUID !== undefined) {
    try {
      return cryptoRef.randomUUID();
    } catch {
      // Fall through to the manual generator.
    }
  }

  const bytes = new Uint8Array(16);
  if (cryptoRef?.getRandomValues !== undefined) {
    cryptoRef.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-` +
    `${hex.slice(16, 20)}-${hex.slice(20)}`
  );
}
