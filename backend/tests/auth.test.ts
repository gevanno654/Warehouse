/**
 * Authentication tests (AUTH-01 … AUTH-09 in `docs/testing.md`).
 *
 * These run against the isolated test database through the real application,
 * so the middleware, the token service, the bcrypt comparison, and the error
 * envelope are all exercised as shipped.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  api,
  bearer,
  createUser,
  createUserWithToken,
  signToken,
  TEST_JWT_EXPIRES_IN_SECONDS,
  TEST_JWT_SECRET,
  TEST_PASSWORD,
} from "./helpers/api.js";
import { disconnectTestDatabase, getTestPrisma, resetDatabase } from "./helpers/db.js";

interface LoginBody {
  data: {
    accessToken: string;
    tokenType: string;
    expiresIn: number;
    user: { id: string; email: string; role: string };
  };
}

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

const asLogin = (body: unknown): LoginBody => body as LoginBody;
const asError = (body: unknown): ErrorBody => body as ErrorBody;

const SUPERVISOR_EMAIL = "supervisor.auth@example.com";
const OPERATOR_EMAIL = "operator.auth@example.com";

describe("POST /api/v1/auth/login", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await disconnectTestDatabase();
  });

  it("returns 200 with a token and the approved user shape", async () => {
    const user = await createUser(getTestPrisma(), {
      email: SUPERVISOR_EMAIL,
      role: "SUPERVISOR",
    });

    const response = await api(getTestPrisma())
      .post("/api/v1/auth/login")
      .send({ email: SUPERVISOR_EMAIL, password: TEST_PASSWORD });

    expect(response.status).toBe(200);

    const body = asLogin(response.body);
    expect(body.data.tokenType).toBe("Bearer");
    expect(body.data.expiresIn).toBe(TEST_JWT_EXPIRES_IN_SECONDS);
    expect(body.data.accessToken).toEqual(expect.any(String));
    expect(body.data.user).toEqual({
      id: user.id,
      email: SUPERVISOR_EMAIL,
      role: "SUPERVISOR",
    });
  });

  it("accepts an email in a different case and returns the stored lower-case form", async () => {
    await createUser(getTestPrisma(), { email: OPERATOR_EMAIL, role: "OPERATOR" });

    const response = await api(getTestPrisma())
      .post("/api/v1/auth/login")
      .send({ email: "Operator.Auth@Example.COM", password: TEST_PASSWORD });

    expect(response.status).toBe(200);
    expect(asLogin(response.body).data.user.email).toBe(OPERATOR_EMAIL);
  });

  it("rejects a wrong password with 401 UNAUTHENTICATED", async () => {
    await createUser(getTestPrisma(), { email: OPERATOR_EMAIL, role: "OPERATOR" });

    const response = await api(getTestPrisma())
      .post("/api/v1/auth/login")
      .send({ email: OPERATOR_EMAIL, password: "definitely-not-the-password" });

    expect(response.status).toBe(401);
    expect(asError(response.body).error.code).toBe("UNAUTHENTICATED");
  });

  it("does not reveal whether an email exists", async () => {
    await createUser(getTestPrisma(), { email: OPERATOR_EMAIL, role: "OPERATOR" });

    const unknown = await api(getTestPrisma())
      .post("/api/v1/auth/login")
      .send({ email: "nobody@example.com", password: TEST_PASSWORD });

    const wrongPassword = await api(getTestPrisma())
      .post("/api/v1/auth/login")
      .send({ email: OPERATOR_EMAIL, password: "wrong-password" });

    expect(unknown.status).toBe(wrongPassword.status);
    expect(asError(unknown.body)).toEqual(asError(wrongPassword.body));
    expect(asError(unknown.body).error.message.toLowerCase()).not.toContain("not found");
  });

  it("rejects a missing password with 400 VALIDATION_ERROR", async () => {
    const response = await api(getTestPrisma())
      .post("/api/v1/auth/login")
      .send({ email: OPERATOR_EMAIL });

    expect(response.status).toBe(400);
    expect(asError(response.body).error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a missing body with 400 VALIDATION_ERROR", async () => {
    const response = await api(getTestPrisma()).post("/api/v1/auth/login");

    expect(response.status).toBe(400);
    expect(asError(response.body).error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a malformed email with 400 VALIDATION_ERROR", async () => {
    const response = await api(getTestPrisma())
      .post("/api/v1/auth/login")
      .send({ email: "not-an-email", password: TEST_PASSWORD });

    expect(response.status).toBe(400);
    expect(asError(response.body).error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects an empty password with 400 VALIDATION_ERROR", async () => {
    const response = await api(getTestPrisma())
      .post("/api/v1/auth/login")
      .send({ email: OPERATOR_EMAIL, password: "" });

    expect(response.status).toBe(400);
    expect(asError(response.body).error.code).toBe("VALIDATION_ERROR");
  });

  it("never returns the password hash or the signing secret", async () => {
    await createUser(getTestPrisma(), { email: SUPERVISOR_EMAIL, role: "SUPERVISOR" });

    const response = await api(getTestPrisma())
      .post("/api/v1/auth/login")
      .send({ email: SUPERVISOR_EMAIL, password: TEST_PASSWORD });

    const serialised = JSON.stringify(response.body);
    expect(serialised).not.toMatch(/passwordHash|password_hash|\$2[aby]\$/);
    expect(serialised).not.toContain(TEST_JWT_SECRET);
    expect(response.headers["set-cookie"]).toBeUndefined();
  });
});

describe("GET /api/v1/auth/me", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await disconnectTestDatabase();
  });

  it("returns the authenticated identity", async () => {
    const user = await createUserWithToken(getTestPrisma(), {
      email: OPERATOR_EMAIL,
      role: "OPERATOR",
    });

    const response = await api(getTestPrisma())
      .get("/api/v1/auth/me")
      .set("Authorization", bearer(user.token));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: { id: user.id, email: OPERATOR_EMAIL, role: "OPERATOR" },
    });
  });

  it("rejects a request with no Authorization header", async () => {
    const response = await api(getTestPrisma()).get("/api/v1/auth/me");

    expect(response.status).toBe(401);
    expect(asError(response.body).error.code).toBe("UNAUTHENTICATED");
  });

  it.each([
    ["a non-Bearer scheme", (token: string) => `Basic ${token}`],
    ["a missing token", () => "Bearer"],
    ["a blank token", () => "Bearer   "],
    ["an unprefixed token", (token: string) => token],
  ])("rejects %s with 401", async (_label, formatHeader) => {
    const user = await createUserWithToken(getTestPrisma(), {
      email: OPERATOR_EMAIL,
      role: "OPERATOR",
    });

    const response = await api(getTestPrisma())
      .get("/api/v1/auth/me")
      .set("Authorization", formatHeader(user.token));

    expect(response.status).toBe(401);
    expect(asError(response.body).error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects a token with an invalid signature", async () => {
    const user = await createUser(getTestPrisma(), {
      email: OPERATOR_EMAIL,
      role: "OPERATOR",
    });
    const forged = await signToken(
      { userId: user.id, role: "OPERATOR" },
      { secret: "a-different-signing-secret-value" },
    );

    const response = await api(getTestPrisma())
      .get("/api/v1/auth/me")
      .set("Authorization", bearer(forged));

    expect(response.status).toBe(401);
    expect(asError(response.body).error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects an expired token", async () => {
    const user = await createUser(getTestPrisma(), {
      email: OPERATOR_EMAIL,
      role: "OPERATOR",
    });
    const expired = await signToken(
      { userId: user.id, role: "OPERATOR" },
      { expiresInSeconds: 0 },
    );

    const response = await api(getTestPrisma())
      .get("/api/v1/auth/me")
      .set("Authorization", bearer(expired));

    expect(response.status).toBe(401);
    expect(asError(response.body).error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects a malformed token", async () => {
    const response = await api(getTestPrisma())
      .get("/api/v1/auth/me")
      .set("Authorization", "Bearer not.a.jwt");

    expect(response.status).toBe(401);
    expect(asError(response.body).error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects a token whose account no longer exists", async () => {
    const user = await createUserWithToken(getTestPrisma(), {
      email: OPERATOR_EMAIL,
      role: "OPERATOR",
    });
    await getTestPrisma().user.delete({ where: { id: user.id } });

    const response = await api(getTestPrisma())
      .get("/api/v1/auth/me")
      .set("Authorization", bearer(user.token));

    expect(response.status).toBe(401);
    expect(asError(response.body).error.code).toBe("UNAUTHENTICATED");
  });
});
