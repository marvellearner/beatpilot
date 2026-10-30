// Tests get their own config so they don't load the app's Vite plugins (and with them the API server)
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
