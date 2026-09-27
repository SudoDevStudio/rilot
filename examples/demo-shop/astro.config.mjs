// @ts-check
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';

// On GitHub Pages the demo ships under /<repo>/demo/; locally it is the root.
const site = process.env.PUBLIC_SITE ?? 'https://sudodevstudio.github.io';
const base = process.env.PUBLIC_BASE_PATH ?? '/';

export default defineConfig({
  site,
  base,
  trailingSlash: 'ignore',
  // A static site: every shop page is a real URL, which is exactly the path
  // Rilot routes for it. No server, no API keys — the engine runs in the page.
  output: 'static',
  build: { format: 'directory' },
  integrations: [react(), sitemap({ changefreq: 'monthly' })],
  vite: {
    resolve: {
      alias: {
        // Shared TypeScript binding for rilot-core.wasm, also used by the
        // Cloudflare adapter and the policy playground.
        '@rilot/core-js': fileURLToPath(new URL('../../packages/rilot-js/src', import.meta.url))
      }
    },
    server: { fs: { allow: ['..', '../../packages'] } }
  }
});
