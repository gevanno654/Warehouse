/**
 * Authentication and authorisation middleware.
 *
 * `AGENTS.md` §4 requires enforcement on the backend, independent of the
 * frontend. The role check here is the only thing that protects
 * `POST /api/v1/products`; the `x-required-role` extension in the OpenAPI
 * document is documentation metadata and is not read by this code.
 */
import type { RequestHandler } from "express";

import type { UserRole } from "@prisma/client";

import { forbiddenError, unauthenticatedError } from "../lib/errors.js";
import type { TokenService } from "../lib/tokens.js";

/** Identity attached to the request by `authenticate`. */
export interface AuthenticatedUser {
  readonly id: string;
  readonly role: UserRole;
}

export interface AuthenticatedRequest {
  user: AuthenticatedUser;
}

/**
 * Extracts the bearer token from the `Authorization` header.
 *
 * Returns `undefined` for a missing header, a non-Bearer scheme, or an empty
 * token, so every one of those cases produces the same `401` response.
 */
function readBearerToken(header: string | undefined): string | undefined {
  if (header === undefined) {
    return undefined;
  }

  const match = /^Bearer +(\S+) *$/i.exec(header);
  return match?.[1];
}

export function createAuthenticateMiddleware(tokens: TokenService): RequestHandler {
  return (request, _response, next) => {
    const token = readBearerToken(request.headers.authorization);

    if (token === undefined) {
      next(unauthenticatedError());
      return;
    }

    tokens
      .verify(token)
      .then((claims) => {
        // The request is typed as `Request`; this is the single place the
        // identity is attached, and `requireRole` reads it back.
        (request as unknown as AuthenticatedRequest).user = {
          id: claims.userId,
          role: claims.role,
        };
        next();
      })
      .catch(() => {
        // Signature, expiry, claim, and format failures are all the same to the
        // client: the token is not usable.
        next(unauthenticatedError());
      });
  };
}

/**
 * Rejects an authenticated user whose role is not in `roles`.
 *
 * `403 FORBIDDEN` rather than `404`, so a permitted route is never disguised as
 * missing, matching `docs/technical-spec.md` §5.
 */
export function requireRole(...roles: readonly UserRole[]): RequestHandler {
  return (request, _response, next) => {
    const user = (request as Partial<AuthenticatedRequest>).user;

    if (user === undefined) {
      // Defensive: reachable only if `requireRole` is mounted without
      // `authenticate`. Failing closed keeps the route protected.
      next(unauthenticatedError());
      return;
    }

    if (!roles.includes(user.role)) {
      next(forbiddenError());
      return;
    }

    next();
  };
}

/** Narrows a request to one carrying an authenticated identity. */
export function getAuthenticatedUser(request: unknown): AuthenticatedUser {
  const user = (request as Partial<AuthenticatedRequest>).user;

  if (user === undefined) {
    // Programming error: a handler mounted without `authenticate`.
    throw new Error("Authenticated user is not attached to the request.");
  }

  return user;
}
