import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './responsive.css';
import { installVisualViewportHeightVar } from './visualViewportHeight';

installVisualViewportHeightVar();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
