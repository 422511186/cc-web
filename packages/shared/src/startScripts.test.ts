import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const thisDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(thisDir, "../../../");

function script(name: string): string {
  return readFileSync(resolve(repoRoot, name), "utf8");
}

describe("Windows startup scripts", () => {
  it("start-host.bat documents and sets the P2P Host runtime environment", () => {
    const content = script("start-host.bat");

    expect(content).toContain("P2P_SIGNAL_URL");
    expect(content).toContain("PUBLIC_SIGNAL_URL");
    expect(content).toContain("PUBLIC_WEB_BASE_URL");
    expect(content).toContain("P2P_HOST_ID");
    expect(content).toContain("P2P_WEB_URL");
    expect(content).toContain("P2P_ICE_LOCAL_ADDRESS");
    expect(content).toContain("P2P_STATE_FILE");
    expect(content).toContain("CodeRelay Signal");
  });

  it("start-web.bat points users at the Host UI where they can add devices", () => {
    const content = script("start-web.bat");

    expect(content).toContain("Host 管理页");
    expect(content).toContain("http://localhost:3002/host");
    expect(content).toContain("VITE_CODERELAY_SIGNAL_URL");
    expect(content).toContain("CodeRelay Signal");
    expect(content).toContain("P2P");
  });
});
