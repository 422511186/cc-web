import { describe, it, expect, beforeEach, vi } from 'vitest';
import { searchSessions } from './search.js';
import type { SessionStore } from './store.js';

describe('searchSessions', () => {
  let mockStore: SessionStore;

  beforeEach(() => {
    mockStore = {
      listProjects: vi.fn(),
      listSessions: vi.fn(),
      getSession: vi.fn(),
    } as any;
  });

  it('should find sessions matching search query in message content', async () => {
    vi.mocked(mockStore.listProjects).mockResolvedValue([
      { id: 'project1', name: 'Project 1', path: '/path1' },
    ]);

    vi.mocked(mockStore.listSessions).mockResolvedValue([
      {
        id: 'session1',
        projectId: 'project1',
        title: 'Test Session',
        createdAt: 1000,
        updatedAt: 2000,
        messageCount: 2,
      },
    ]);

    vi.mocked(mockStore.getSession).mockResolvedValue({
      id: 'session1',
      projectId: 'project1',
      title: 'Test Session',
      createdAt: 1000,
      updatedAt: 2000,
      messageCount: 2,
      messages: [
        { role: 'user', content: 'How do I fix this bug?', timestamp: 1000 },
        { role: 'assistant', content: 'Here is the solution', timestamp: 2000 },
      ],
    });

    const results = await searchSessions(mockStore, 'bug');

    expect(results).toHaveLength(1);
    expect(results[0].sessionId).toBe('session1');
    expect(results[0].title).toBe('Test Session');
    expect(results[0].matches).toHaveLength(1);
    expect(results[0].matches[0].message.content).toBe('How do I fix this bug?');
    expect(results[0].matches[0].snippet).toContain('bug');
  });

  it('should be case-insensitive', async () => {
    vi.mocked(mockStore.listProjects).mockResolvedValue([
      { id: 'project1', name: 'Project 1', path: '/path1' },
    ]);

    vi.mocked(mockStore.listSessions).mockResolvedValue([
      {
        id: 'session1',
        projectId: 'project1',
        title: 'Test',
        createdAt: 1000,
        updatedAt: 2000,
        messageCount: 1,
      },
    ]);

    vi.mocked(mockStore.getSession).mockResolvedValue({
      id: 'session1',
      projectId: 'project1',
      title: 'Test',
      createdAt: 1000,
      updatedAt: 2000,
      messageCount: 1,
      messages: [
        { role: 'user', content: 'HELLO World', timestamp: 1000 },
      ],
    });

    const results = await searchSessions(mockStore, 'hello');

    expect(results).toHaveLength(1);
    expect(results[0].matches).toHaveLength(1);
  });

  it('should return empty array when no matches found', async () => {
    vi.mocked(mockStore.listProjects).mockResolvedValue([
      { id: 'project1', name: 'Project 1', path: '/path1' },
    ]);

    vi.mocked(mockStore.listSessions).mockResolvedValue([
      {
        id: 'session1',
        projectId: 'project1',
        title: 'Test',
        createdAt: 1000,
        updatedAt: 2000,
        messageCount: 1,
      },
    ]);

    vi.mocked(mockStore.getSession).mockResolvedValue({
      id: 'session1',
      projectId: 'project1',
      title: 'Test',
      createdAt: 1000,
      updatedAt: 2000,
      messageCount: 1,
      messages: [
        { role: 'user', content: 'No match here', timestamp: 1000 },
      ],
    });

    const results = await searchSessions(mockStore, 'xyz');

    expect(results).toHaveLength(0);
  });

  it('should create snippet with context around match', async () => {
    vi.mocked(mockStore.listProjects).mockResolvedValue([
      { id: 'project1', name: 'Project 1', path: '/path1' },
    ]);

    vi.mocked(mockStore.listSessions).mockResolvedValue([
      {
        id: 'session1',
        projectId: 'project1',
        title: 'Test',
        createdAt: 1000,
        updatedAt: 2000,
        messageCount: 1,
      },
    ]);

    vi.mocked(mockStore.getSession).mockResolvedValue({
      id: 'session1',
      projectId: 'project1',
      title: 'Test',
      createdAt: 1000,
      updatedAt: 2000,
      messageCount: 1,
      messages: [
        {
          role: 'user',
          content: 'This is a very long message that contains the keyword somewhere in the middle of the text',
          timestamp: 1000,
        },
      ],
    });

    const results = await searchSessions(mockStore, 'keyword');

    expect(results).toHaveLength(1);
    expect(results[0].matches[0].snippet).toContain('keyword');
    expect(results[0].matches[0].snippet.length).toBeLessThanOrEqual(150);
  });

  it('should find multiple matches in same session', async () => {
    vi.mocked(mockStore.listProjects).mockResolvedValue([
      { id: 'project1', name: 'Project 1', path: '/path1' },
    ]);

    vi.mocked(mockStore.listSessions).mockResolvedValue([
      {
        id: 'session1',
        projectId: 'project1',
        title: 'Test',
        createdAt: 1000,
        updatedAt: 2000,
        messageCount: 3,
      },
    ]);

    vi.mocked(mockStore.getSession).mockResolvedValue({
      id: 'session1',
      projectId: 'project1',
      title: 'Test',
      createdAt: 1000,
      updatedAt: 2000,
      messageCount: 3,
      messages: [
        { role: 'user', content: 'First test message', timestamp: 1000 },
        { role: 'assistant', content: 'Response', timestamp: 2000 },
        { role: 'user', content: 'Second test message', timestamp: 3000 },
      ],
    });

    const results = await searchSessions(mockStore, 'test');

    expect(results).toHaveLength(1);
    expect(results[0].matches).toHaveLength(2);
  });
});
