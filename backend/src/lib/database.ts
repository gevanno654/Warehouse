import { PrismaClient } from "@prisma/client";

/**
 * Creates the shared Prisma client.
 *
 * Phase 1 defines the connection only; the schema has no models yet.
 * The client is created once per process and reused.
 */
export function createPrismaClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({
    datasourceUrl: databaseUrl,
  });
}

/**
 * Readiness probe.
 *
 * Issues a trivial query rather than trusting that the pool is initialised:
 * a running process is not proof that PostgreSQL is reachable.
 *
 * Returns `false` instead of throwing so the caller can map the outcome to the
 * `503 SERVICE_UNAVAILABLE` response defined in `docs/openapi.yaml`.
 */
export async function checkDatabaseConnection(client: PrismaClient): Promise<boolean> {
  try {
    await client.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
