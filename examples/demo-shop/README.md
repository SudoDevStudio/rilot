# GreenCart — a shop with Rilot's decisions next to it

A split-screen demo: a small storefront on the left, and on the right the routing decision Rilot made for **that exact request**.

```text
+---------------------------+--------------------------------+
|  GreenCart                |  1  Request   GET /reports/...  |
|  Home Products Cart Impact|  2  Rule      /reports/*        |
|                           |  3  Carbon    3 regions asked   |
|  [ product grid ]         |  4  Candidates east/west/dublin |
|                           |  5  Decision  -> dublin, 118 ms |
+---------------------------+--------------------------------+
```

It is an [Astro](https://astro.build) site, and that is the point: **every page is a real URL, and that URL is the path Rilot routes.** Opening `/reports/monthly` in the address bar *is* the request; the panel beside it explains where it went. The cart, the shopper's city, the grid clock and the request history live in `sessionStorage`, so they survive real navigations.

| You open | Path | Rule | What you see |
| --- | --- | --- | --- |
| Home, Products, Cart | `/`, `/products`, `/cart` | none -> root config | `balanced`: a cleaner region wins unless it is too far |
| Checkout, then Pay | `/checkout`, `POST /checkout/pay` | `/checkout/*` | `latency` + 1500 km: the carbon step is **skipped entirely** |
| Store report | `/reports/monthly` | `/reports/*` | `carbon`, no radius: the request travels to the cleanest grid |
| Our impact | `/green/impact` | `/green/*` | `carbon`; the shop's page about the grid, showing all three regions right now |

Two actions are requests without being pages: **Add to cart** (`POST /cart/items`) and the newsletter signup (`POST /newsletter/subscribe`). Both are routed in front of you without the page reloading.

Two controls change the world:

- **Shopper in** - move the customer to London or Singapore and watch backends fall outside the radius.
- **Grid clock** - drag through the day; solar makes regions take turns being the cleanest, and the report follows.

## Policy per page

The routing panel has two tabs. **This request** explains the decision just made; **Policy** (tinted amber, because it changes things rather than reporting them) lets you set a policy per route, from any page:

| Route | Ships as | You can set |
| --- | --- | --- |
| `/` | `balanced` (root) | latency · balanced · carbon |
| `/products/*` | `balanced` (root) | latency · balanced · carbon |
| `/cart/*` | `balanced` (root) | latency · balanced · carbon |
| `/reports/*` | `carbon` (rule) | latency · balanced · carbon |
| `/checkout/*` | `latency` (rule) | locked, with the reason shown |

Each choice writes exactly one routing rule into the live config. A route that had no rule gets one appended; a route that already has one keeps it and only its `policy` changes, so an override can never be shadowed by the original (rules are matched by specificity, and ties go to the earliest one). Nothing else about the rule moves — set `/reports/*` to `latency` and it still has `radius_km: null` from the config, it just stops asking for carbon.

Choosing a policy is an operator control, not a shop feature, which is why it lives in the panel rather than on a shop page — the shop side keeps only the customer-facing grid table on **Our impact**. The picker is built from real `<input type="radio">` elements, so it works from the keyboard without any script. The policy shown as active is the one the **engine** resolves for that path, not what the UI last clicked, and the line underneath shows where the page would be served from right now — at 13:00 UTC from New York, moving the catalog to `carbon` takes it from `east` (305 g/kWh) to `dublin` (134 g/kWh).

Choices live in `sessionStorage`, so they follow you across real page navigations and are gone when the tab closes. **Reset to the config** clears them.

## Forms the browser validates

`/checkout` contains no validation code. Every rule is an HTML attribute - `required`, `type="email"`, `pattern`, `minlength`, `maxlength` - so the browser refuses an invalid form and writes the message itself, and the styling comes from `:user-invalid`. An empty form, or a card number that is not sixteen digits, never reaches JavaScript. What JavaScript does is what happens *after* a valid submit: route `POST /checkout/pay` and empty the cart.

## Run it

```bash
rustup target add wasm32-unknown-unknown   # once
cd examples/demo-shop
npm install
npm run dev            # http://localhost:4321
```

Or from the repository root: `./run-it/demo-shop.sh`.

## Deploying

The site is static. `npm run build` writes `dist/`, and two environment variables tell it where it will live:

```bash
PUBLIC_SITE=https://example.github.io PUBLIC_BASE_PATH=/rilot/demo/ npm run build
```

They drive internal links, canonical URLs, `sitemap-index.xml` and `robots.txt`.

**GitHub Pages** publishes it at `/<repo>/demo/`, next to the policy playground - see [the Pages workflow](../../.github/workflows/policy-playground-pages.yml), which reads both values from the Pages configuration instead of hard-coding them.

**Vercel** serves it at the root of its own domain, and `vercel.json` here is all it needs:

```bash
npm i -g vercel
cd examples/demo-shop
vercel deploy --prod
```

No environment variables are required. The site URL is taken from Vercel's own `VERCEL_PROJECT_PRODUCTION_URL`, so canonicals, the sitemap and `robots.txt` come out right on the first deploy; set `PUBLIC_SITE` only if you serve it from a domain Vercel does not know about.

One thing to know: the build compiles `rilot-core` to WebAssembly, which needs Rust. `vercel.json` therefore installs a minimal toolchain in `installCommand` before `npm ci`, which adds a minute or so to a cold build. If you would rather not build Rust on Vercel, build the site in CI and deploy the output with `vercel deploy --prebuilt`; `scripts/build-wasm.mjs` reuses an existing `src/rilot/generated/rilot_core.wasm` when cargo is unavailable.

Every page carries its own title, description, keywords, canonical link, Open Graph and Twitter cards, and JSON-LD. The structured data describes *the demo and Rilot* (`WebSite`, `SoftwareApplication`, `BreadcrumbList`) - deliberately not `Product`/`Offer`, because the shop is fictional and that markup would be a claim to sell something.

## What is real and what is simulated

**Real:** the decision. `rilot-core` is compiled to WebAssembly and runs in the page, the same Rust code native Rilot and the Cloudflare Worker execute. The flow follows the production sequence - `plan()` first, carbon fetched only for the regions it asks for, then `decide()` - and hysteresis state is kept per route, like an adapter does.

**Simulated:** the shop, the three backends, their response times, and — by default — the carbon feed (a daily solar curve instead of Electricity Maps). Nothing leaves your browser, so the demo works as a static page with no server and no API keys.

**Optionally real carbon.** Point the demo at any Rilot deployment's carbon API and it stops simulating:

```bash
PUBLIC_CARBON_API=https://rilot-edge.example.workers.dev/__rilot/carbon npm run build
```

The endpoint is read-only, CORS-enabled and serves the cached signals the deployment is actually routing on, so no API key reaches the page. When it is set, the grid table and the flow panel say where the numbers came from and the grid clock no longer drives them; when the fetch fails the demo falls back to the simulation rather than breaking. Locally: `./run-it/native.sh`, then `PUBLIC_CARBON_API=http://127.0.0.1:8080/__rilot/carbon npm run dev`.

CO2e figures use the same model as native Rilot (`docs/model-calibration.md`): estimates, not measurements.

## Layout

```text
src/
  pages/               one .astro file per URL - the paths Rilot sees
  layouts/Shop.astro   the split screen, shared by every page
  components/islands/  the interactive parts (React, hydrated per page)
  rilot/               config, simulated carbon, the engine, one request -> one decision
  shop/                catalog, and the request each page makes
  state/store.ts       cart, city, clock, history - sessionStorage, shared by the islands
```

## Tests

```bash
npm test
```

The tests pin the story: checkout stays latency-routed and carbon-free even when every settable route is switched to carbon, the report and the impact page chase the cleanest grid by default, a chosen policy reaches the route it names (all three, for every control) and changes nothing else about an existing rule, carbon is fetched only when the chosen policy needs it, a distant shopper triggers the radius fallback, and the winner changes as the grid clock moves.
