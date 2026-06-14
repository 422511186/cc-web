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

  return (
    <>
      {/* Hamburger Menu Button */}
      {isMobile && (
        <button
          onClick={toggleMenu}
          aria-label="打开菜单"
          style={{
            position: 'fixed',
            top: '1rem',
            left: '1rem',
            zIndex: 1001,
            width: '48px',
            height: '48px',
            backgroundColor: '#1976d2',
            border: 'none',
            borderRadius: '12px',
            cursor: 'pointer',
            display: isOpen ? 'none' : 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '5px',
            boxShadow: '0 4px 12px rgba(25, 118, 210, 0.3)',
            transition: 'all 0.2s',
          }}
          onMouseDown={(e) => {
            e.currentTarget.style.transform = 'scale(0.95)';
          }}
          onMouseUp={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
          }}
        >
          <span style={{
            width: '20px',
            height: '2px',
            backgroundColor: 'white',
            borderRadius: '2px',
          }} />
          <span style={{
            width: '20px',
            height: '2px',
            backgroundColor: 'white',
            borderRadius: '2px',
          }} />
          <span style={{
            width: '20px',
            height: '2px',
            backgroundColor: 'white',
            borderRadius: '2px',
          }} />
        </button>
      )}

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
              width: '32px',
              height: '32px',
              backgroundColor: 'transparent',
              border: 'none',
              cursor: 'pointer',
              fontSize: '1.5rem',
              color: '#666',
            }}
          >
            ×
          </button>
        )}
        {children}
      </div>
    </>
  );
}
