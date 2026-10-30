/**
 * Authentication state for the application shell.
 *
 * The provider restores a stored session on boot and validates it against
 * `GET /api/v1/auth/me`; a stored token the backend no longer accepts lands
 * back on the login screen. Every fetch failure with a `401` status anywhere
 * in the app calls `signOut("Your session expired. Please sign in again.")`,
 * which is why the sign-out reason is threaded through here.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type JSX,
  type ReactNode,
} from "react";

import { getCurrentUser, login as loginRequest, type User } from "../services/api.js";
import { clearSession, loadSession, saveSession } from "../services/session.js";

export interface AuthState {
  readonly user: User | null;
  readonly token: string | null;
  readonly ready: boolean;
  readonly notice: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: (notice?: string) => void;
  dismissNotice: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const stored = loadSession();
    if (stored === null) {
      setReady(true);
      return;
    }

    let cancelled = false;
    void getCurrentUser(stored.token)
      .then((current) => {
        if (!cancelled) {
          setUser(current);
          setToken(stored.token);
          saveSession({ token: stored.token, user: current });
        }
      })
      .catch(() => {
        // Unknown, expired, or orphaned token: start signed out.
        if (!cancelled) {
          clearSession();
        }
      })
      .finally(() => {
        if (!cancelled) {
          setReady(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string): Promise<void> => {
    const result = await loginRequest({ email, password });
    setUser(result.user);
    setToken(result.accessToken);
    setNotice(null);
    saveSession({ token: result.accessToken, user: result.user });
  }, []);

  const signOut = useCallback((reason?: string): void => {
    setUser(null);
    setToken(null);
    setNotice(reason ?? null);
    clearSession();
  }, []);

  const dismissNotice = useCallback((): void => {
    setNotice(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, token, ready, notice, signIn, signOut, dismissNotice }),
    [user, token, ready, notice, signIn, signOut, dismissNotice],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const state = useContext(AuthContext);
  if (state === null) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return state;
}
