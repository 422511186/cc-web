import { describe, it, expect, vi, beforeEach } from "vitest";

// mock SDK 的 query,捕获传入的 options
const queryMock = vi.fn(() => (async function* () {})());
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: (args: unknown) => queryMock(args),
}));

import { realSdkClient } from "./sdk.js";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

const emptyPrompt = (async function* (): AsyncIterable<SDKUserMessage> {})();

function baseParams() {
  return {
    prompt: emptyPrompt,
    permissionMode: "default",
    canUseTool: async () => ({ behavior: "allow" as const, updatedInput: {} }),
    abortController: new AbortController(),
  };
}

describe("realSdkClient", () => {
  beforeEach(() => queryMock.mockClear());

  it("续聊(带 resume)时传 forkSession:false,续写原会话不 fork", () => {
    realSdkClient.start({ ...baseParams(), resume: "sess-1" });
    const opts = (queryMock.mock.calls[0][0] as { options: Record<string, unknown> }).options;
    expect(opts.resume).toBe("sess-1");
    expect(opts.forkSession).toBe(false);
  });

  it("新建(无 resume)时不强制 forkSession", () => {
    realSdkClient.start({ ...baseParams() });
    const opts = (queryMock.mock.calls[0][0] as { options: Record<string, unknown> }).options;
    expect(opts.resume).toBeUndefined();
    expect(opts.forkSession).toBeUndefined();
  });

  it("bypassPermissions 模式应显式传 allowDangerouslySkipPermissions", () => {
    realSdkClient.start({ ...baseParams(), permissionMode: "bypassPermissions" });
    const opts = (queryMock.mock.calls[0][0] as { options: Record<string, unknown> }).options;
    expect(opts.permissionMode).toBe("bypassPermissions");
    expect(opts.allowDangerouslySkipPermissions).toBe(true);
  });

  it("非 bypass 初始模式也应允许后续通过控制通道切换到 bypassPermissions", () => {
    realSdkClient.start({ ...baseParams(), permissionMode: "auto" });
    const opts = (queryMock.mock.calls[0][0] as { options: Record<string, unknown> }).options;
    expect(opts.permissionMode).toBe("auto");
    expect(opts.allowDangerouslySkipPermissions).toBe(true);
  });

  it("canUseTool 回调抛错时应返回 deny,避免异常穿透到 SDK", async () => {
    realSdkClient.start({
      ...baseParams(),
      canUseTool: async () => {
        throw new Error("boom");
      },
    });

    const opts = (queryMock.mock.calls[0][0] as {
      options: {
        canUseTool: (
          toolName: string,
          input: Record<string, unknown>,
          meta: { toolUseID: string; title?: string }
        ) => Promise<unknown>;
      };
    }).options;

    await expect(
      opts.canUseTool("Bash", { command: "echo hi" }, { toolUseID: "tool-1" })
    ).resolves.toEqual({
      behavior: "deny",
      message: "tool permission callback failed",
    });
  });
});
