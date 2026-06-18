import type { Response } from 'express';
import type { SessionStore } from './store.js';

interface SSEClient {
  res: Response;
  id: number;
}

export class SSEManager {
  private clients: Map<number, SSEClient> = new Map();
  private nextClientId = 0;
  private pingInterval: NodeJS.Timeout | null = null;

  constructor(private store: SessionStore) {
    // Start keep-alive ping every 30 seconds
    this.pingInterval = setInterval(() => {
      this.sendToAll(':ping\n\n');
    }, 30000);
  }

  handleConnection(res: Response): void {
    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // Add client
    const clientId = this.nextClientId++;
    this.clients.set(clientId, { res, id: clientId });
    console.log(`✓ SSE client connected: ${clientId}, total clients: ${this.clients.size}`);

    // Handle client disconnect
    res.on('close', () => {
      this.clients.delete(clientId);
      console.log(`✗ SSE client disconnected: ${clientId}, total clients: ${this.clients.size}`);
    });
  }

  notifySessionUpdate(projectId: string, sessionId: string): void {
    const data = JSON.stringify({ projectId, sessionId });
    const message = `event: session-update\ndata: ${data}\n\n`;
    console.log(`Broadcasting session update: ${projectId}/${sessionId} to ${this.clients.size} clients`);
    this.sendToAll(message);
  }

  getClientCount(): number {
    return this.clients.size;
  }

  close(): void {
    // Stop ping interval
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    // Close all client connections
    for (const client of this.clients.values()) {
      client.res.end();
    }
    this.clients.clear();
  }

  private sendToAll(message: string): void {
    for (const client of this.clients.values()) {
      client.res.write(message);
    }
  }
}
