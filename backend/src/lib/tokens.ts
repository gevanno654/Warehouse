/**
 * Access-token issuing and verification.
 *
 * `docs/technical-spec.md` §7 requires a signed JWT with an explicit expiry.
 * Tokens are HS256 with the `JWT_SECRET` from validated configuration. `jose`
 * verifies the signature, the `exp` claim, and the algorithm, and rejects
 * `alg: none` and algorithm-substitution attempts.
 */
import { jwtVerify, SignJWT } from "jose";

import type { UserRole } from "@prisma/client";

/** Claims carried by an access token. `sub` and `role` are the only ones read. */
export interface AccessTokenClaims {
  readonly userId: string;
  readonly role: UserRole;
}

const ALGORITHM = "HS256";
const ISSUER = "warehouse-receiving";
const AUDIENCE = "warehouse-receiving-api";

export interface TokenServiceOptions {
  readonly secret: string;
  /** Lifetime in seconds. */
  readonly expiresInSeconds: number;
}

export interface TokenService {
  /** Signs a token and returns it with its lifetime in seconds. */
  issue(claims: AccessTokenClaims): Promise<{ token: string; expiresIn: number }>;
  /**
   * Verifies a token.
   *
   * @throws {Error} for any signature, expiry, claim, or format failure. The
   *         failure reason is not sent to the client, so no distinction is
   *         exposed between an expired and a forged token.
   */
  verify(token: string): Promise<AccessTokenClaims>;
}

function signingKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export function createTokenService(options: TokenServiceOptions): TokenService {
  const key = signingKey(options.secret);

  return {
    async issue(claims) {
      const token = await new SignJWT({ role: claims.role })
        .setProtectedHeader({ alg: ALGORITHM })
        .setSubject(claims.userId)
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setIssuedAt()
        .setExpirationTime(`${options.expiresInSeconds}s`)
        .sign(key);

      return { token, expiresIn: options.expiresInSeconds };
    },

    async verify(token) {
      const { payload } = await jwtVerify(token, key, {
        algorithms: [ALGORITHM],
        issuer: ISSUER,
        audience: AUDIENCE,
      });

      const userId = payload.sub;
      const role = payload["role"];

      // A token signed with the right key but missing the claims the API relies
      // on is not usable. Treat it as an authentication failure, not a 500.
      if (typeof userId !== "string" || userId === "") {
        throw new Error("Access token is missing the subject claim.");
      }
      if (role !== "OPERATOR" && role !== "SUPERVISOR") {
        throw new Error("Access token carries an unrecognised role claim.");
      }

      return { userId, role };
    },
  };
}
