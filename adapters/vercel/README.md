# Rilot on Vercel

A Vercel Edge Function that routes requests with **the same decision engine as native Rilot**: `crates/rilot-core`, compiled to WebAssembly.

It is deliberately thin. Everything that is not Vercel-specific — building the request context, the decision, the introspection endpoints, forwarding — lives in `packages/rilot-http` and is shared with the Cloudflare Worker, so the two hosts cannot drift apart:

```text
request ─▶ plan()  ─▶ carbon regions ─▶ CarbonService (Vercel KV + provider)
                                                   │
        fetch(backend) ◀── DecisionOutput ◀── decide()
```

| Responsibility | Where |
| --- | --- |
| Routing rules, radius, constraints, scoring, fallback, hysteresis | `rilot-core` (Rust → Wasm) |
| Endpoints, request context, forwarding, research headers | `packages/rilot-http` (shared with Cloudflare) |
| Vercel request metadata (`x-vercel-ip-*`, region), config, KV transport | `src/` |
| Carbon cache, freshness, provider calls | `packages/rilot-carbon` (shared layer) |

No routing logic lives in this adapter.

## Prerequisites

```bash
rustup target add wasm32-unknown-unknown   # the function bundles rilot-core.wasm
cd adapters/vercel
npm install
```

`npm run serve`, `npm test` and `npm run deploy` compile `rilot-core` to Wasm first (`scripts/build-wasm.mjs`).

## Run locally

Two ways, and the first needs no Vercel account:

```bash
npm run serve        # a plain Node server on http://127.0.0.1:8788
npm run dev          # `vercel dev`, if you have the CLI and a linked project
```

`npm run serve` bundles the TypeScript with esbuild — the same thing Vercel's build does — and mounts the exact handler the Edge Function exports. From the repository root, `./run-it/vercel.sh` does this with a ready-made config pointing at the local backend simulators.

```bash
# Which engine is running, and in which region
curl http://127.0.0.1:8788/__rilot/health

# The carbon signals this deployment routes on
curl http://127.0.0.1:8788/__rilot/carbon
curl "http://127.0.0.1:8788/__rilot/carbon?regions=us-west-2"

# Decide without forwarding: useful before real backends exist
curl "http://127.0.0.1:8788/__rilot/decision?path=/reports/monthly"

# Pretend to be somewhere else — Vercel's own geolocation headers
curl -H 'x-vercel-ip-latitude: 53.35' -H 'x-vercel-ip-longitude: -6.26' \
  "http://127.0.0.1:8788/__rilot/decision?path=/reports/monthly"
```

## Deploy

```bash
npm i -g vercel
vercel login
cd adapters/vercel
npm run deploy         # builds the Wasm, then `vercel deploy --prod`
```

Set these in the project's **Settings → Environment Variables**:

| Variable | Purpose |
| --- | --- |
| `RILOT_CONFIG` | the routing config as JSON — **required** |
| `RILOT_EXPOSE_RESEARCH_HEADERS` | `true` to add the `x-rilot-*` headers to forwarded responses |
| `ELECTRICITYMAP_API_KEY` | Electricity Maps token, if you use that provider |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | added automatically when you connect a KV store |

`vercel.json` rewrites every path to the function, so Rilot sees the caller's original URL and can route on it.

The API key belongs in the environment, never in `RILOT_CONFIG` and never in anything the browser can read. The `/__rilot/carbon` endpoint exposes cached grid intensities, which are not secret, but never the token that fetched them.

### Carbon caching

With a KV store connected, last-known-good signals survive instance recycling; without one, the adapter runs on its in-memory store alone and simply refetches more often. Both are correct — the freshness rules come from `crates/rilot-carbon-policy`, not from the host.

`src/kv.ts` speaks the Upstash REST API directly (a command as a JSON array), so there is no SDK to keep up to date and the whole transport is about forty lines.

## Request headers

| Header | Effect |
| --- | --- |
| `x-vercel-ip-latitude`, `x-vercel-ip-longitude` | supplied by Vercel; used for radius and distance |
| `x-user-location: <lat>,<lon>` | pins coordinates (wins over Vercel's geolocation) |
| `x-user-region` | pins the canonical region |
| `x-rilot-policy: carbon` | policy for this request; reported as `policy_source: "request"` |
| `x-rilot-class`, `x-rilot-carbon-cursor`, `x-rilot-forecasting`, `x-rilot-time-shift` | override policy behaviour per request |
| `Cookie: rilot_policy=/products/*:carbon` | policy for this session, matched by the engine |

Both geolocation headers must be present for Vercel's position to be used: `Number(null)` is `0`, and 0°,0° is a real place every backend would be measured against.

Full rules: [docs/config-reference.md](../../docs/config-reference.md).

## Tests

```bash
npm test
```

21 tests, in plain Node — the handler is a `(Request) => Response`, so no platform emulator is needed, and everything the platform provides (geolocation, environment, KV) arrives as data. They cover health and region reporting, geolocation and its overrides, both routing rules, forwarding with and without the research headers, the 503 path, the carbon API, the session cookie, and Vercel KV through a fake Upstash endpoint — including what happens when that store is unreachable.

## Differences from the Cloudflare Worker

Same engine, same shared HTTP layer, same carbon layer. What differs:

- **Config** comes only from `RILOT_CONFIG`; there is no KV fallback, because a Vercel environment variable holds far more than a routing config needs.
- **Background work.** A Worker has `ctx.waitUntil`; an Edge Function does not, so a background carbon refresh is fire-and-forget and may be cut short — the next request just refreshes again. Pass `schedule` (for example `waitUntil` from `@vercel/functions`) if you want the stronger guarantee.
- **Hysteresis** is per instance here too, so stickiness is best-effort rather than global. See the Worker's README for the same caveat.
