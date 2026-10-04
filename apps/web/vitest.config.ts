import { defineConfig } from 'vitest/config';

// App tests are plain Node checks (no browser, no Vite plugins).
export default defineConfig({
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
});
