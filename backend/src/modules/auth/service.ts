/**
 * Authentication logic.
 *
 * Kept out of the route handler so the credential policy is testable on its own
 * and the route stays a thin HTTP adapter.
 *
 * Policy from `docs/technical-spec.md` §7 and `docs/prd.md`:
 * - Emails are normalised to lower case before lookup.
 * - An unknown email and a wrong password are indistinguishable: both compare
 *   against a real bcrypt hash and both return `401 UNAUTHENTICATED`.
 * - Nothing derived from the password hash reaches the caller.
 */
import bcrypt from "bcrypt";

import type { PrismaClient, UserRole } from "@prisma/client";

import { invalidCredentialsError } from "../../lib/errors.js";

export interface AuthenticatedUserRecord {
  readonly id: string;
  readonly email: string;
  readonly role: UserRole;
}

export interface LoginResult {
  readonly user: AuthenticatedUserRecord;
}

/**
 * A pre-computed bcrypt hash used when no account matches.
 *
 * Verifying against it makes the unknown-email path do the same bcrypt work as
 * a wrong password, so response time does not reveal whether an account
 * exists. The plaintext behind it is irrelevant because a successful match is
 * discarded.
 */
const DUMMY_HASH = bcrypt.hashSync("unused-placeholder-not-a-credential", 12);

export async function verifyCredentials(
  prisma: PrismaClient,
  input: { readonly email: string; readonly password: string },
): Promise<LoginResult> {
  const email = input.email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });

  const passwordMatches = await bcrypt.compare(
    input.password,
    user?.passwordHash ?? DUMMY_HASH,
  );

  // Both conditions are checked together and produce the same error, so an
  // attacker cannot separate "no such account" from "wrong password".
  if (user === null || !passwordMatches) {
    throw invalidCredentialsError();
  }

  return {
    user: { id: user.id, email: user.email, role: user.role },
  };
}

export interface UserProfile {
  readonly id: string;
  readonly email: string;
  readonly role: UserRole;
}

/**
 * Loads the current user for `GET /api/v1/auth/me`.
 *
 * Returns `undefined` when the token is valid but the account no longer exists,
 * so a deleted user cannot keep using an unexpired token.
 */
export async function findUserProfile(
  prisma: PrismaClient,
  userId: string,
): Promise<UserProfile | undefined> {
  const user = await prisma.user.findUnique({ where: { id: userId } });

  return user === null
    ? undefined
    : { id: user.id, email: user.email, role: user.role };
}
