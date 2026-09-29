import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

// The tests cover the routing modules, which are plain TypeScript — no Astro
// or React involved, so they run without the Astro plugin.
export default defineConfig({
  resolve: {
    alias: {
      '@rilot/core-js': fileURLToPath(new URL('../../packages/rilot-js/src', import.meta.url))
    }
  },
  test: { environment: 'node' }
});
