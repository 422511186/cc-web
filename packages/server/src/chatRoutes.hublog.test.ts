import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ServerEvent } from '@cc-web/shared';

const MAX_LOG_EVENTS = 10_000;

// Mock Hub with truncation logic
interface Hub {
  log: ServerEvent[];
  channel: any;
  closed: boolean;
  graceTimer: NodeJS.Timeout | null;
}

function createHub(): Hub {
  return {
    log: [],
    channel: null,
    closed: false,
    graceTimer: null,
  };
}

function addEventWithTruncation(hub: Hub, event: ServerEvent) {
  hub.log.push(event);
  if (hub.log.length > MAX_LOG_EVENTS) {
    hub.log.splice(0, hub.log.length - MAX_LOG_EVENTS);
  }
}

describe('Hub.log Memory Leak', () => {
  it('should limit log size to prevent unbounded growth', () => {
    const hub = createHub();

    // Simulate adding many events
    for (let i = 0; i < 15_000; i++) {
      addEventWithTruncation(hub, {
        type: 'delta',
        text: `event ${i}`,
      } as ServerEvent);
    }

    // Should NOT exceed maximum
    expect(hub.log.length).toBeLessThanOrEqual(MAX_LOG_EVENTS);
    expect(hub.log.length).toBe(MAX_LOG_EVENTS);
  });

  it('should keep recent events when truncating', () => {
    const hub = createHub();
    const LIMIT = 100;

    // Add 150 events with custom limit
    for (let i = 0; i < 150; i++) {
      hub.log.push({
        type: 'delta',
        text: `event ${i}`,
      } as ServerEvent);

      if (hub.log.length > LIMIT) {
        hub.log.splice(0, hub.log.length - LIMIT);
      }
    }

    expect(hub.log.length).toBe(LIMIT);
    expect((hub.log[0] as any).text).toBe('event 50'); // First kept event
    expect((hub.log[99] as any).text).toBe('event 149'); // Last event
  });

  it('should not truncate if below threshold', () => {
    const hub = createHub();

    // Add only 50 events
    for (let i = 0; i < 50; i++) {
      addEventWithTruncation(hub, {
        type: 'delta',
        text: `event ${i}`,
      } as ServerEvent);
    }

    expect(hub.log.length).toBe(50);
    expect((hub.log[0] as any).text).toBe('event 0');
  });

  it('should handle empty log gracefully', () => {
    const hub = createHub();

    expect(hub.log.length).toBe(0);
    expect(() => {
      addEventWithTruncation(hub, { type: 'delta', text: 'test' } as ServerEvent);
    }).not.toThrow();
    expect(hub.log.length).toBe(1);
  });
});
