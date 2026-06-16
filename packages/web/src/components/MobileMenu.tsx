import { useState, useEffect, ReactNode } from 'react';

interface MobileMenuProps {
  children: ReactNode;
}

export function MobileMenu({ children }: MobileMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.matchMedia('(max-width: 768px)').matches);
    };

    checkMobile();
    const mediaQuery = window.matchMedia('(max-width: 768px)');
    mediaQuery.addEventListener('change', checkMobile);

    return () => mediaQuery.removeEventListener('change', checkMobile);
  }, []);

  const toggleMenu = () => {
    setIsOpen(!isOpen);
  };

  const closeMenu = () => {
    setIsOpen(false);
  };

  // Expose toggle function globally for header button to use
  useEffect(() => {
    (window as any).__toggleMobileMenu = toggleMenu;
    return () => {
      delete (window as any).__toggleMobileMenu;
    };
  }, []);

  return (
    <>

      {/* Overlay */}
      {isMobile && isOpen && (
        <div
          data-testid="mobile-overlay"
          onClick={closeMenu}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            zIndex: 999,
          }}
        />
      )}

      {/* Sidebar Container */}
      <div
        style={{
          transform: isMobile ? (isOpen ? 'translateX(0)' : 'translateX(-100%)') : 'none',
          transition: 'transform 0.3s ease-in-out',
          position: isMobile ? 'fixed' : 'relative',
          top: 0,
          left: 0,
          bottom: 0,
          zIndex: 1000,
          width: isMobile ? '80%' : 'auto',
          maxWidth: isMobile ? '300px' : 'none',
        }}
      >
        {children}
        {/* Close Button */}
        {isMobile && isOpen && (
          <button
            onClick={closeMenu}
            aria-label="关闭菜单"
            style={{
              position: 'absolute',
              top: '1rem',
              right: '1rem',
              zIndex: 1001,
              width: '36px',
              height: '36px',
              backgroundColor: '#f5f5f5',
              border: '1px solid #e0e0e0',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '1.25rem',
              color: '#666',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#e8e8e8';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#f5f5f5';
            }}
          >
            ✕
          </button>
        )}
      </div>
    </>
  );
}
