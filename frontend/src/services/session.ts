/**
 * Session persistence.
 *
 * Decision: the JWT lives in `sessionStorage`, not `localStorage`.
 * `sessionStorage` is scoped to the tab and cleared when it closes, so a
 * token left on a shared machine dies with the tab instead of surviving for
 * the next user. This is a harm-reduction tradeoff, not a security boundary:
 * any script running in the page (XSS) can read either storage, and no browser
 * token storage is fully secure. Real protection is short token lifetimes and
 * backend enforcement on every route — hiding a UI action is not a control.
 *
 * Nothing here logs the token; the value is opaque to every caller.
 */
import type { User } from "./api.js";

const TOKEN_KEY = "wrs.accessToken";
const USER_KEY = "wrs.currentUser";

export interface StoredSession {
  readonly token: string;
  readonly user: User;
}

function readStorage(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    // Private browsing or a disabled store: behave as signed-out.
    return null;
  }
}

export function loadSession(): StoredSession | null {
  const token = readStorage(TOKEN_KEY);
  const rawUser = readStorage(USER_KEY);
  if (token === null || token === "" || rawUser === null) {
    return null;
  }
  try {
    const user = JSON.parse(rawUser) as User;
    if (
      typeof user !== "object" ||
      user === null ||
      typeof user.id !== "string" ||
      typeof user.email !== "string" ||
      (user.role !== "OPERATOR" && user.role !== "SUPERVISOR")
    ) {
      return null;
    }
    return { token, user };
  } catch {
    return null;
  }
}

export function saveSession(session: StoredSession): void {
  try {
    window.sessionStorage.setItem(TOKEN_KEY, session.token);
    window.sessionStorage.setItem(USER_KEY, JSON.stringify(session.user));
  } catch {
    // Storage full or unavailable: the in-memory session still works for this
    // tab; a reload will simply land on the login screen.
  }
}

export function clearSession(): void {
  try {
    window.sessionStorage.removeItem(TOKEN_KEY);
    window.sessionStorage.removeItem(USER_KEY);
  } catch {
    // Best effort; in-memory state is cleared by the caller regardless.
  }
}
