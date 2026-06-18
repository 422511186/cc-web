import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = fileURLToPath(new URL("..", import.meta.url));
const tmpDir = path.join(packageDir, ".tmp");
const projectsDir = path.join(tmpDir, "claude-projects");
const imageCacheDir = path.join(tmpDir, "image-cache");
const uploadsDir = path.join(tmpDir, "uploads");
const projectId = "coderelay-e2e-project";
const sessionId = "session-e2e-1";
const projectCwd = path.join(tmpDir, "workspace", projectId);
const projectDir = path.join(projectsDir, projectId);

await fs.rm(tmpDir, { recursive: true, force: true });
await fs.mkdir(projectDir, { recursive: true });
await fs.mkdir(projectCwd, { recursive: true });
await fs.mkdir(imageCacheDir, { recursive: true });
await fs.mkdir(uploadsDir, { recursive: true });

const lines = [
  {
    cwd: projectCwd,
    type: "user",
    message: { content: "E2E hello from browser" },
    timestamp: "2026-06-18T18:00:00.000Z",
  },
  {
    type: "assistant",
    message: {
      content: [{ type: "text", text: "E2E assistant answer over local Host" }],
      model: "claude-e2e",
    },
    timestamp: "2026-06-18T18:00:01.000Z",
  },
];

await fs.writeFile(
  path.join(projectDir, `${sessionId}.jsonl`),
  `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
  "utf8",
);

console.log(`Prepared CodeRelay E2E fixture at ${tmpDir}`);
