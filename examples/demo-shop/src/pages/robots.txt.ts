import type { APIRoute } from 'astro';
import { href } from '../lib/links';

/** Generated so the sitemap URL always matches wherever the demo is deployed. */
export const GET: APIRoute = ({ site }) => {
  const sitemap = new URL(href('/sitemap-index.xml'), site ?? 'http://localhost:4321').toString();
  return new Response(`User-agent: *\nAllow: /\n\nSitemap: ${sitemap}\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
};
