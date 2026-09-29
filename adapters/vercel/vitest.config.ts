import { defineConfig } from 'vitest/config';

// The handler is a plain `(Request) => Response`, so it runs in Node without a
// platform emulator: the tests drive it the same way Vercel's runtime does.
export default defineConfig({
  test: { environment: 'node' }
});
