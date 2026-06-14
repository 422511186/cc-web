import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SessionStore } from './store.js';
import { SSEManager } from './sse.js';
describe('SSEManager', () => {
    let store;
    let sseManager;
    let mockResponse;
    let writtenData;
    beforeEach(() => {
        store = new SessionStore('/fake/path');
        sseManager = new SSEManager(store);
        writtenData = [];
        mockResponse = {
            writeHead: vi.fn(),
            write: vi.fn((data) => {
                writtenData.push(data);
                return true;
            }),
            end: vi.fn(),
            on: vi.fn(),
        };
    });
    afterEach(() => {
        sseManager.close();
    });
    it('sends SSE headers on connection', () => {
        sseManager.handleConnection(mockResponse);
        expect(mockResponse.writeHead).toHaveBeenCalledWith(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        });
    });
    it('sends session update event when session changes', async () => {
        sseManager.handleConnection(mockResponse);
        // Simulate session update
        sseManager.notifySessionUpdate('project1', 'session1');
        // Wait for async event processing
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(writtenData.length).toBeGreaterThan(0);
        const lastMessage = writtenData[writtenData.length - 1];
        expect(lastMessage).toContain('event: session-update');
        expect(lastMessage).toContain('"projectId":"project1"');
        expect(lastMessage).toContain('"sessionId":"session1"');
    });
    it('removes client on connection close', () => {
        const res = mockResponse;
        let closeCallback;
        res.on = vi.fn((event, callback) => {
            if (event === 'close') {
                closeCallback = callback;
            }
            return res;
        });
        sseManager.handleConnection(res);
        expect(sseManager.getClientCount()).toBe(1);
        // Simulate connection close
        closeCallback?.();
        expect(sseManager.getClientCount()).toBe(0);
    });
    it('sends keep-alive ping every 30 seconds', async () => {
        vi.useFakeTimers();
        const manager = new SSEManager(store);
        manager.handleConnection(mockResponse);
        writtenData = [];
        // Fast-forward 30 seconds
        await vi.advanceTimersByTimeAsync(30000);
        expect(writtenData.length).toBeGreaterThan(0);
        expect(writtenData[0]).toContain(':ping');
        manager.close();
        vi.useRealTimers();
    });
    it('handles multiple clients', () => {
        const res1 = { ...mockResponse };
        const res2 = { ...mockResponse };
        sseManager.handleConnection(res1);
        sseManager.handleConnection(res2);
        expect(sseManager.getClientCount()).toBe(2);
        sseManager.notifySessionUpdate('project1', 'session1');
        // Both clients should receive the message
        expect(res1.write).toHaveBeenCalled();
        expect(res2.write).toHaveBeenCalled();
    });
    it('closes all connections on shutdown', () => {
        const res1 = mockResponse;
        const res2 = { ...mockResponse, end: vi.fn() };
        sseManager.handleConnection(res1);
        sseManager.handleConnection(res2);
        sseManager.close();
        expect(res1.end).toHaveBeenCalled();
        expect(res2.end).toHaveBeenCalled();
        expect(sseManager.getClientCount()).toBe(0);
    });
});
//# sourceMappingURL=sse.test.js.map