import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const e2eDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = path.resolve(e2eDir, "../..");
const tmpDir = path.join(e2eDir, ".tmp");

const authToken = process.env.E2E_AUTH_TOKEN ?? "test-token-123456";
const hostPort = process.env.E2E_HOST_PORT ?? "33102";
const webPort = process.env.E2E_WEB_PORT ?? "33100";
const signalPort = process.env.E2E_SIGNAL_PORT ?? "33104";
const hostUrl = `http://127.0.0.1:${hostPort}`;
const webUrl = `http://127.0.0.1:${webPort}`;
const signalUrl = `ws://127.0.0.1:${signalPort}/`;

const inheritedEnv = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
);

export default defineConfig({
  testDir: "./tests",
  timeout: 90_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [["dot"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: webUrl,
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "npm run start --workspace @coderelay/signal",
      cwd: repoRoot,
      url: `http://127.0.0.1:${signalPort}/healthz`,
      reuseExistingServer: false,
      timeout: 45_000,
      env: {
        ...inheritedEnv,
        PORT: signalPort,
      },
    },
    {
      command: "node apps/e2e/scripts/prepare-fixture.mjs && npm run start --workspace @coderelay/host",
      cwd: repoRoot,
      url: `${hostUrl}/healthz`,
      reuseExistingServer: false,
      timeout: 45_000,
      env: {
        ...inheritedEnv,
        AUTH_TOKEN: authToken,
        PORT: hostPort,
        CLAUDE_PROJECTS_DIR: path.join(tmpDir, "claude-projects"),
        CLAUDE_IMAGE_CACHE_DIR: path.join(tmpDir, "image-cache"),
        UPLOADS_DIR: path.join(tmpDir, "uploads"),
        PERMISSION_MODE: "default",
        P2P_SIGNAL_URL: signalUrl,
        P2P_HOST_ID: "coderelay-e2e-host",
        P2P_WEB_URL: webUrl,
        P2P_ICE_LOCAL_ADDRESS: "127.0.0.1",
      },
    },
    {
      command: `npm run dev --workspace @coderelay/web -- --host 127.0.0.1 --port ${webPort}`,
      cwd: repoRoot,
      url: webUrl,
      reuseExistingServer: false,
      timeout: 45_000,
      env: {
        ...inheritedEnv,
        CODERELAY_DEV_API_TARGET: hostUrl,
        VITE_CODERELAY_SIGNAL_URL: signalUrl,
      },
    },
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
