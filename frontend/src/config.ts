/**
 * API base URL.
 *
 * `VITE_API_BASE_URL` is read at build time by Vite and must always point at
 * the address the *browser* can reach (for example `http://localhost:3000`).
 * Docker-internal service names such as `api` or `db` are never valid here.
 */
export const API_BASE_URL: string = (
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000"
).replace(/\/+$/, "");
