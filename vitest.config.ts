// Tests get their own config so they don't load the app's Vite plugins (and with them the API server)
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Tempo and analysis tests run several minutes of synthetic audio: ~1–3 s alone, slower when
    // the laptop is busy (they timed out at the default 5 s with the dev server and others running)
    testTimeout: 20_000,
  },
});
