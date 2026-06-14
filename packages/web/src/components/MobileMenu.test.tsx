import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import { MobileMenu } from './MobileMenu';

describe('MobileMenu', () => {
  test('toggles sidebar visibility on mobile', () => {
    render(
      <MobileMenu>
        <div data-testid="sidebar-content">Sidebar</div>
      </MobileMenu>
    );

    // Initially sidebar should be hidden on mobile
    const sidebar = screen.getByTestId('sidebar-content');
    const sidebarContainer = sidebar.parentElement;
    expect(sidebarContainer).toHaveStyle({ transform: 'translateX(-100%)' });

    // Click hamburger button to open
    const menuButton = screen.getByLabelText('打开菜单');
    fireEvent.click(menuButton);
    expect(sidebarContainer).toHaveStyle({ transform: 'translateX(0)' });

    // Click close button to close
    const closeButton = screen.getByLabelText('关闭菜单');
    fireEvent.click(closeButton);
    expect(sidebarContainer).toHaveStyle({ transform: 'translateX(-100%)' });
  });

  test('closes sidebar when clicking overlay', () => {
    render(
      <MobileMenu>
        <div data-testid="sidebar-content">Sidebar</div>
      </MobileMenu>
    );

    // Open sidebar
    const menuButton = screen.getByLabelText('打开菜单');
    fireEvent.click(menuButton);

    const sidebar = screen.getByTestId('sidebar-content');
    const sidebarContainer = sidebar.parentElement;
    expect(sidebarContainer).toHaveStyle({ transform: 'translateX(0)' });

    // Click overlay
    const overlay = screen.getByTestId('mobile-overlay');
    fireEvent.click(overlay);
    expect(sidebarContainer).toHaveStyle({ transform: 'translateX(-100%)' });
  });

  test('hides menu button on desktop', () => {
    // Mock window.matchMedia for desktop
    const originalMatchMedia = window.matchMedia;
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

    render(
      <MobileMenu>
        <div>Sidebar</div>
      </MobileMenu>
    );

    // Menu button should not be visible
    expect(screen.queryByLabelText('打开菜单')).not.toBeInTheDocument();

    // Restore original
    window.matchMedia = originalMatchMedia;
  });
});
