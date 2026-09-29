// @ts-check
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';

// Where the demo will live. GitHub Pages serves it under /<repo>/demo/, Vercel
// at the root of its own domain, and `npm run dev` at localhost — so both
// values are taken from the environment, and Vercel's own variables are used
// when nothing else says otherwise.
const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
const site =
  process.env.PUBLIC_SITE ?? (vercelHost ? `https://${vercelHost}` : 'https://sudodevstudio.github.io');
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
