import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const apiTarget = process.env.CODERELAY_DEV_API_TARGET ?? 'http://localhost:3002';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@coderelay/transport': fileURLToPath(new URL('../../packages/transport/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
});
