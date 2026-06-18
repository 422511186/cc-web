import { act, renderHook } from "@testing-library/react";
import type { CodeRelayTransport, TransportSubscribeRequest, TransportStream } from "@coderelay/transport";
import type { ServerEvent } from "@coderelay/shared";
import * as useSessionModule from "./useSession";
import { useSession } from "./useSession";

function setSessionTransportForTest(transport: CodeRelayTransport | null): void {
  const setter = (useSessionModule as unknown as {
    setSessionTransport?: (transport: CodeRelayTransport | null) => void;
  }).setSessionTransport;
  expect(setter).toBeTypeOf("function");
  setter?.(transport);
}

describe("useSession transport", () => {
  afterEach(() => {
    (useSessionModule as unknown as {
      setSessionTransport?: (transport: CodeRelayTransport | null) => void;
    }).setSessionTransport?.(null);
  });

  it("通过注入 transport 订阅 run stream 并在卸载时关闭", () => {
    let request: TransportSubscribeRequest<ServerEvent> | null = null;
    const close = vi.fn();
    const transport: CodeRelayTransport = {
      request: vi.fn(),
      subscribe: vi.fn((nextRequest: TransportSubscribeRequest<ServerEvent>): TransportStream => {
        request = nextRequest;
        return { close };
      }),
    };
    setSessionTransportForTest(transport);

    const { result, unmount } = renderHook(() => useSession("run-1"));

    expect(transport.subscribe).toHaveBeenCalledWith({
      path: "/sessions/run-1/stream",
      onOpen: expect.any(Function),
      onError: expect.any(Function),
      onEvent: expect.any(Function),
    });

    act(() => request?.onOpen?.());
    expect(result.current.connected).toBe(true);

    act(() => request?.onEvent({ type: "status", state: "executing" }));
    expect(result.current.status).toBe("executing");

    unmount();

    expect(close).toHaveBeenCalledTimes(1);
  });
});
