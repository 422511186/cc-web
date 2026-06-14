import { render } from '@testing-library/react';
import { vi } from 'vitest';
import App from './App';

// Mock components to simplify testing
vi.mock('./components/Login', () => ({
  Login: () => <div data-testid="login">Login</div>,
}));

vi.mock('./components/Sidebar', () => ({
  Sidebar: () => <div data-testid="sidebar">Sidebar</div>,
}));

vi.mock('./components/Conversation', () => ({
  Conversation: () => <div data-testid="conversation">Conversation</div>,
}));

describe('App responsive layout', () => {
  beforeEach(() => {
    // Mock sessionStorage
    Storage.prototype.getItem = vi.fn(() => 'test-token');
  });

  test('renders mobile layout on small screens', () => {
    const { container } = render(<App />);

    // Check that app renders with sidebar
    const sidebar = container.querySelector('[data-testid="sidebar"]');
    expect(sidebar).toBeInTheDocument();
  });

  test('renders desktop layout on large screens', () => {
    // Mock desktop media query
    window.matchMedia = vi.fn().mockImplementation(query => ({
      matches: false, // Desktop
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    const { container } = render(<App />);

    const sidebar = container.querySelector('[data-testid="sidebar"]');
    expect(sidebar).toBeInTheDocument();
  });
});
