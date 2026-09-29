import { defineConfig } from 'vitest/config';

// Pure TypeScript over the compiled engine: no platform emulator needed.
export default defineConfig({
  test: { environment: 'node' }
});
