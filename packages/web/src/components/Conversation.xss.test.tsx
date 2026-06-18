import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Conversation } from './Conversation';
import type { ApiClient } from '../api';

function makeApiClient(getSession: ReturnType<typeof vi.fn>): ApiClient {
  return {
    getSession,
    connectSSE: () => () => {}, // Mock SSE connection
    imageUrl: (p: string) => p,
  } as unknown as ApiClient;
}

describe('Conversation XSS Protection', () => {
  let mockApiClient: ApiClient;

  beforeEach(() => {
    const getSession = vi.fn().mockResolvedValue({
      session: {
        id: 'test-session',
        projectId: 'test-project',
        title: 'Test',
        updatedAt: new Date().toISOString(),
        messages: [],
      },
    });
    mockApiClient = makeApiClient(getSession);
  });

  it('should sanitize malicious script tags in markdown content', async () => {
    const maliciousMessage = {
      role: 'assistant' as const,
      content: 'Hello <script>alert("XSS")</script> world',
      timestamp: Date.now(),
    };

    const getSession = vi.fn().mockResolvedValue({
      session: {
        id: 'test-session',
        projectId: 'test-project',
        title: 'Test',
        updatedAt: new Date().toISOString(),
        messages: [maliciousMessage],
      },
    });
    mockApiClient = makeApiClient(getSession);

    render(
      <Conversation
        apiClient={mockApiClient}
        projectId="test-project"
        sessionId="test-session"
      />
    );

    // Wait for async loading
    await screen.findByText(/Hello.*world/i);

    // Script tag should be stripped
    const scripts = document.querySelectorAll('script');
    expect(scripts.length).toBe(0);

    // Content should still render (sanitized)
    expect(screen.getByText(/Hello.*world/i)).toBeInTheDocument();
  });

  it('should sanitize malicious onerror handlers in img tags', async () => {
    const maliciousMessage = {
      role: 'assistant' as const,
      content: '<img src="x" onerror="alert(\'XSS\')">',
      timestamp: Date.now(),
    };

    const getSession = vi.fn().mockResolvedValue({
      session: {
        id: 'test-session',
        projectId: 'test-project',
        title: 'Test',
        updatedAt: new Date().toISOString(),
        messages: [maliciousMessage],
      },
    });
    mockApiClient = makeApiClient(getSession);

    render(
      <Conversation
        apiClient={mockApiClient}
        projectId="test-project"
        sessionId="test-session"
      />
    );

    await screen.findByRole('img');

    const img = screen.getByRole('img') as HTMLImageElement;

    // onerror handler should be stripped
    expect(img.onerror).toBeNull();
    expect(img.getAttribute('onerror')).toBeNull();
  });

  it('should sanitize javascript: protocol in links', async () => {
    const maliciousMessage = {
      role: 'assistant' as const,
      content: '[Click me](javascript:alert("XSS"))',
      timestamp: Date.now(),
    };

    const getSession = vi.fn().mockResolvedValue({
      session: {
        id: 'test-session',
        projectId: 'test-project',
        title: 'Test',
        updatedAt: new Date().toISOString(),
        messages: [maliciousMessage],
      },
    });
    mockApiClient = makeApiClient(getSession);

    render(
      <Conversation
        apiClient={mockApiClient}
        projectId="test-project"
        sessionId="test-session"
      />
    );

    await screen.findByText(/Click me/i);

    const links = document.querySelectorAll('a[href^="javascript:"]');
    expect(links.length).toBe(0);
  });

  it('should allow safe markdown features', async () => {
    const safeMessage = {
      role: 'assistant' as const,
      content: '**Bold** and *italic* and `code` and [link](https://example.com)',
      timestamp: Date.now(),
    };

    const getSession = vi.fn().mockResolvedValue({
      session: {
        id: 'test-session',
        projectId: 'test-project',
        title: 'Test',
        updatedAt: new Date().toISOString(),
        messages: [safeMessage],
      },
    });
    mockApiClient = makeApiClient(getSession);

    render(
      <Conversation
        apiClient={mockApiClient}
        projectId="test-project"
        sessionId="test-session"
      />
    );

    await screen.findByText(/Bold/i);

    // Safe elements should render
    expect(screen.getByText(/Bold/i).tagName).toBe('STRONG');
    expect(screen.getByText(/italic/i).tagName).toBe('EM');
    expect(screen.getByText(/code/i).tagName).toBe('CODE');

    const link = screen.getByText(/link/i);
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('https://example.com');
  });
});
