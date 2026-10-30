/**
 * Authentication endpoints.
 *
 * Contract: `docs/openapi.yaml` — `POST /api/v1/auth/login` (`security: []`)
 * and `GET /api/v1/auth/me`.
 *
 * Handlers stay thin: credential checking lives in `./service.ts`, token
 * signing in `src/lib/tokens.ts`, and the identity attached by the middleware
 * in `src/middleware/auth.ts`.
 */
import { Router } from "express";

import type { PrismaClient } from "@prisma/client";

import { unauthenticatedError } from "../../lib/errors.js";
import { loginRequestSchema } from "../../lib/validation.js";
import type { TokenService } from "../../lib/tokens.js";
import {
  createAuthenticateMiddleware,
  getAuthenticatedUser,
} from "../../middleware/auth.js";
import { findUserProfile, verifyCredentials } from "./service.js";

export interface AuthRouterOptions {
  readonly prisma: PrismaClient;
  readonly tokens: TokenService;
}

export function createAuthRouter({ prisma, tokens }: AuthRouterOptions): Router {
  const router = Router();
  const authenticate = createAuthenticateMiddleware(tokens);

  router.post("/auth/login", async (request, response) => {
    // `parse` throws `ZodError`, which the shared error handler maps to
    // `400 VALIDATION_ERROR` without the route needing to know the envelope.
    const { email, password } = loginRequestSchema.parse(request.body ?? {});
    const { user } = await verifyCredentials(prisma, { email, password });
    const { token, expiresIn } = await tokens.issue({
      userId: user.id,
      role: user.role,
    });

    response.status(200).json({
      data: {
        accessToken: token,
        tokenType: "Bearer",
        expiresIn,
        user: { id: user.id, email: user.email, role: user.role },
      },
    });
  });

  router.get("/auth/me", authenticate, async (request, response) => {
    const identity = getAuthenticatedUser(request);
    const user = await findUserProfile(prisma, identity.id);

    if (user === undefined) {
      // A signed token whose account no longer exists is not usable. The
      // contract documents only `200` and `401` here, so this is `401` rather
      // than a `404` that the client would have no way to handle.
      throw unauthenticatedError();
    }

    response.status(200).json({ data: user });
  });

  return router;
}
