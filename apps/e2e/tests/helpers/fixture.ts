import path from "node:path";
import { fileURLToPath } from "node:url";

export const e2eDir = fileURLToPath(new URL("../..", import.meta.url));
export const tmpDir = path.join(e2eDir, ".tmp");
export const projectsDir = path.join(tmpDir, "claude-projects");
export const imageCacheDir = path.join(tmpDir, "image-cache");
export const uploadsDir = path.join(tmpDir, "uploads");

export const authToken = process.env.E2E_AUTH_TOKEN ?? "test-token-123456";
export const hostPort = Number.parseInt(process.env.E2E_HOST_PORT ?? "33102", 10);
export const hostUrl = `http://127.0.0.1:${hostPort}`;

export const projectId = "coderelay-e2e-project";
export const projectName = "coderelay-e2e-project";
export const sessionId = "session-e2e-1";
export const userPrompt = "E2E hello from browser";
export const assistantAnswer = "E2E assistant answer over local Host";
