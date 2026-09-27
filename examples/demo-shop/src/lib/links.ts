// The demo is served from the site root locally and from /<repo>/demo/ on
// GitHub Pages, so every internal link goes through here.
const BASE = import.meta.env.BASE_URL;

/** `/products` → `/rilot/demo/products` (or `/products` when the base is `/`). */
export function href(path: string): string {
  const clean = path.startsWith('/') ? path.slice(1) : path;
  const base = BASE.endsWith('/') ? BASE : `${BASE}/`;
  return `${base}${clean}`;
}

/** The path Rilot routes for a page URL, i.e. the URL without the base. */
export function rilotPath(pathname: string): string {
  const base = BASE.endsWith('/') ? BASE.slice(0, -1) : BASE;
  const path = base && pathname.startsWith(base) ? pathname.slice(base.length) : pathname;
  const trimmed = path.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}
