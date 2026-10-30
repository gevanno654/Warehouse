import { createServer } from "node:http";

import { createApp } from "./app.js";
import { loadConfig } from "./config/index.js";
import { checkDatabaseConnection, createPrismaClient } from "./lib/database.js";
import { ConfigurationError } from "./config/env.js";

function start(): void {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigurationError) {
      // Fail fast with an actionable message and a non-zero exit code.
      console.error(`[api] configuration is invalid; refusing to start.\n${error.message}`);
      process.exit(1);
    }
    throw error;
  }

  const prisma = createPrismaClient(config.databaseUrl);
  const app = createApp({
    config,
    checkDatabase: () => checkDatabaseConnection(prisma),
    prisma,
  });

  const server = createServer(app);

  server.listen(config.port, () => {
    console.log(`[api] listening on port ${config.port} (${config.nodeEnv})`);
  });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[api] received ${signal}; shutting down`);

    server.close(() => {
      void prisma.$disconnect().finally(() => process.exit(0));
    });

    // Do not hang forever on a stuck connection.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

start();
