/**
 * Login screen.
 *
 * Submits `{ email, password }` to `POST /api/v1/auth/login` through the
 * auth context. Field errors come from the contract (`400`); wrong
 * credentials are `401 UNAUTHENTICATED` with a deliberately generic message
 * that never reveals whether the account exists. The submit button locks
 * while the request is in flight to prevent duplicate submissions.
 */
import { useState, type FormEvent, type JSX } from "react";

import { useAuth } from "../auth/AuthContext.js";
import { Banner } from "../components/ui.js";
import { isApiError, userFacingMessage } from "../services/api.js";

export function LoginScreen(): JSX.Element {
  const { signIn, notice, dismissNotice } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (submitting) {
      return;
    }

    if (email.trim() === "" || password === "") {
      setFieldError("Email and password are required.");
      return;
    }

    setFieldError(null);
    dismissNotice();
    setSubmitting(true);
    try {
      await signIn(email, password);
    } catch (error) {
      // `401` (wrong credentials) and `400` (malformed input) both render as
      // form errors; anything else is a connectivity/server problem.
      setFieldError(userFacingMessage(error));
      if (isApiError(error) && error.status >= 500) {
        // Keep server failures distinguishable without leaking internals.
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="card" aria-labelledby="login-heading">
      <h2 id="login-heading" className="card__title">
        Sign in
      </h2>
      {notice === null ? null : <Banner tone="info">{notice}</Banner>}
      {fieldError === null ? null : <Banner tone="error">{fieldError}</Banner>}
      <form onSubmit={(event) => void handleSubmit(event)} noValidate={false}>
        <div className="field">
          <label htmlFor="login-email">Email</label>
          <input
            id="login-email"
            name="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={submitting}
          />
        </div>
        <div className="field">
          <label htmlFor="login-password">Password</label>
          <input
            id="login-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={submitting}
          />
        </div>
        <button type="submit" className="button" disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </section>
  );
}
