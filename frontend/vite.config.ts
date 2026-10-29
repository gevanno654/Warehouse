import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/** Repository root, where the single documented `.env` lives. */
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

/**
 * Reads one value from the repository-root `.env`.
 *
 * `loadEnv()` and `envDir` are deliberately not used: the root `.env` also
 * sets the backend's `NODE_ENV=development`, and Vite treats that value as the
 * user's node environment, which switches the production build to a
 * development React bundle. Only `VITE_API_BASE_URL` is needed here.
 */
function readRootEnvValue(key: string): string | undefined {
  const envPath = resolve(repositoryRoot, ".env");
  if (!existsSync(envPath)) {
    return undefined;
  }

  for (const rawLine of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) {
      continue;
    }

    const separator = line.indexOf("=");
    if (separator === -1 || line.slice(0, separator).trim() !== key) {
      continue;
    }

    return line
      .slice(separator + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/, "$2");
  }

  return undefined;
}

export default defineConfig(() => {
  // A real environment variable (or Docker build argument) wins over `.env`.
  // Vite inlines this value at build time.
  const apiBaseUrl = process.env["VITE_API_BASE_URL"] ?? readRootEnvValue("VITE_API_BASE_URL");

  return {
    plugins: [react()],
    define:
      apiBaseUrl === undefined || apiBaseUrl === ""
        ? {}
        : { "import.meta.env.VITE_API_BASE_URL": JSON.stringify(apiBaseUrl) },
    server: {
      // The browser reaches the API through the host, never a Compose hostname.
      host: true,
      port: 5173,
    },
    preview: {
      host: true,
      port: 5173,
    },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./vitest.setup.ts"],
      include: ["src/**/*.test.tsx", "src/**/*.test.ts"],
      restoreMocks: true,
      clearMocks: true,
    },
  };
});
