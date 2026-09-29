import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');

  return {
    base: env.VITE_BASE_PATH || '/',
    plugins: [react()],
    resolve: {
      alias: {
        // Shared TypeScript binding for rilot-core.wasm, also used by the Cloudflare adapter.
        '@rilot/core-js': fileURLToPath(new URL('../../packages/rilot-js/src', import.meta.url))
      }
    },
    server: {
      fs: { allow: ['..', '../../packages'] }
    },
    test: {
      environment: 'node'
    }
  };
});
