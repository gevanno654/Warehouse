import { resolve } from "node:path";

import { config as loadDotenvConfig } from "dotenv";
import { defineConfig } from "prisma/config";

// The documented `.env` lives at the repository root. Loading it here keeps
// `npx prisma ...` working when the command is run from `backend/`.
// `.env` files are never committed; see `.env.example`.
loadDotenvConfig({ path: resolve(process.cwd(), ".env"), quiet: true });
loadDotenvConfig({ path: resolve(process.cwd(), "..", ".env"), quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
});
