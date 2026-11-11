import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api/provider': {
        target: 'http://127.0.0.1:3003',
        rewrite: (path) => path.replace(/^\/api\/provider/, ''),
      },
      '/api/orders': {
        target: 'http://127.0.0.1:3001',
        rewrite: (path) => path.replace(/^\/api\/orders/, ''),
      },
      '/api/payments': {
        target: 'http://127.0.0.1:3002',
        rewrite: (path) => path.replace(/^\/api\/payments/, ''),
      },
    },
  },
});
