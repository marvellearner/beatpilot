import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { aiDjApiPlugin } from './server/apiPlugin.ts';

export default defineConfig({
  plugins: [react(), tailwindcss(), aiDjApiPlugin()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    cors: true,
  },
});
