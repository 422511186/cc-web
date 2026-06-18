import type { Response } from "express";
import type { ServerEvent } from "@coderelay/shared";

/** 把一个 Express Response 包成 SSE 通道。 */
export class SseChannel {
  private res: Response;

  constructor(res: Response) {
    this.res = res;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    // 立即刷出头,前端 EventSource 才会进入 open
    res.flushHeaders?.();
    // 立即写入一帧注释,避免浏览器等到下一次 heartbeat 才触发 open。
    this.res.write(`: connected\n\n`);
  }

  send(event: ServerEvent): void {
    this.res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  /** 注释行心跳,保持连接不被代理掐断 */
  heartbeat(): void {
    this.res.write(`: ping\n\n`);
  }

  onClose(cb: () => void): void {
    this.res.on("close", cb);
  }

  end(): void {
    this.res.end();
  }
}
