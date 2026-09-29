# Rilot on Cloudflare Workers

A Cloudflare Worker that routes requests with **the same decision engine as native Rilot**: `crates/rilot-core`, compiled to WebAssembly.

The Worker owns transport only:

```text
request ─▶ plan()  ─▶ carbon regions ─▶ CarbonService (KV + provider)
                                                   │
        fetch(backend) ◀── DecisionOutput ◀── decide()
```

| Responsibility | Where |
| --- | --- |
| Routing rules, radius, constraints, scoring, fallback, hysteresis | `rilot-core` (Rust → Wasm) |
| Request metadata (`cf.latitude/longitude`, headers) | `src/index.ts` |
| Carbon cache, freshness, provider calls | `packages/rilot-carbon` (shared layer) |
| Choosing the provider and stores for this runtime | `src/carbon.ts` |

No routing logic lives in this adapter.

## Prerequisites

```bash
rustup target add wasm32-unknown-unknown   # the Worker bundles rilot-core.wasm
cd adapters/cloudflare
npm install                                # needs Node 22+: wrangler requires it
```

`npm run dev`, `npm test`, and `npm run deploy` compile `rilot-core` to Wasm first (`scripts/build-wasm.mjs`).

## Run locally

```bash
npm run dev          # wrangler dev on http://127.0.0.1:8787
```

```bash
# Which engine is running, and where
curl http://127.0.0.1:8787/__rilot/health

# Decide without forwarding: useful before real backends exist
curl "http://127.0.0.1:8787/__rilot/decision?path=/checkout/pay"
curl "http://127.0.0.1:8787/__rilot/decision?path=/reports/monthly" -H 'x-user-region: eu-west-1'

# Normal traffic (forwarded to the selected backend)
curl -i http://127.0.0.1:8787/anything
```

`/__rilot/decision` returns the full `DecisionOutput`: matched rule, effective config, every candidate with its distance, latency, carbon status and rejection reason, plus the selected backend.

## Deploy

```bash
npx wrangler login

# 1. KV namespace for last-known-good carbon signals
npx wrangler kv namespace create CARBON
npx wrangler kv namespace create CARBON --preview
# paste both ids into the [[kv_namespaces]] block in wrangler.toml

# 2. Carbon provider credentials (never put these in [vars])
npx wrangler secret put ELECTRICITYMAP_API_KEY

# 3. Your backends
#    edit RILOT_CONFIG in wrangler.toml, or store the config in KV:
#    npx wrangler kv key put --binding CARBON_KV "rilot:config" --path ./my-config.json --remote

npm run deploy
```

Then test the deployment:

```bash
curl https://rilot-edge.<your-subdomain>.workers.dev/__rilot/health
curl "https://rilot-edge.<your-subdomain>.workers.dev/__rilot/decision?path=/reports/monthly"
```

To put real traffic through it, add a route or custom domain in `wrangler.toml`:

```toml
routes = [{ pattern = "app.example.com/*", zone_name = "example.com" }]
```

## Configuration

`RILOT_CONFIG` (a var, or KV key `rilot:config`) is the normal Rilot config, plus an adapter-owned `carbon` section:

```json
{
  "carbon": { "provider": "electricitymap", "max_age_seconds": 300, "provider_timeout_ms": 1500 },
  "backends": [
    { "id": "east", "region": "us-east-1", "url": "https://east.example.com" },
    { "id": "dublin", "region": "eu-west-1", "url": "https://dublin.example.com" }
  ],
  "policy": "balanced",
  "radius_km": 6000,
  "fallback": "nearest",
  "routing_rules": [{ "path": "/checkout/*", "policy": "latency", "radius_km": 1500 }]
}
```

Carbon providers: `electricitymap` (needs the secret), `json` (`carbon.json_source` URL returning the normalized format), `static` (`carbon.zone_current`), or `none`.

See [docs/config-reference.md](../../docs/config-reference.md) for every routing field.

| Binding / var | Purpose |
| --- | --- |
| `RILOT_CONFIG` | Routing config JSON (or KV key `rilot:config`) |
| `CARBON_KV` | Workers KV holding `carbon:<region>` last-known-good signals |
| `ELECTRICITYMAP_API_KEY` | Electricity Maps token (secret) |
| `RILOT_EXPOSE_RESEARCH_HEADERS` | `"true"` adds `x-rilot-*` headers to responses |

## Request headers

By default the caller's position comes from Cloudflare's `cf.latitude`/`cf.longitude`. Two headers override that, which is how you test a deployed Worker from your desk:

```bash
# pretend to be in Dublin
curl -H 'x-user-location: 53.35,-6.26' \
  "https://rilot-edge.<your-subdomain>.workers.dev/__rilot/decision?path=/reports/monthly"

# pretend to be in a specific region
curl -H 'x-user-region: ap-southeast-1' \
  "https://rilot-edge.<your-subdomain>.workers.dev/__rilot/decision?path=/reports/monthly"
```

| Header | Effect |
| --- | --- |
| `x-user-location: <lat>,<lon>` | pins coordinates (wins over Cloudflare geolocation) |
| `x-user-region` | pins the canonical region |
| `x-rilot-policy: carbon` | policy for this request; beats rule and root, reported as `policy_source: "request"` |
| `x-rilot-class`, `x-rilot-carbon-cursor`, `x-rilot-forecasting`, `x-rilot-time-shift` | override policy behavior per request |

An unparseable location header is ignored, and Cloudflare's own geolocation is used instead.

### Session policy cookie

The Worker also honours a per-session policy cookie, so a site can let visitors
choose how its own pages are routed:

```bash
curl -H 'cookie: rilot_policy=/products/*:carbon,/checkout/*:latency' \
  "https://rilot-edge.<your-subdomain>.workers.dev/__rilot/decision?path=/products"
```

Patterns are matched with the same specificity rules as `routing_rules`, by the
engine itself (`crates/rilot-core/src/cookie.rs`), so the Worker and the native
proxy cannot drift. A malformed cookie is ignored, and an explicit
`x-rilot-policy` header wins. Full rules: [docs/config-reference.md](../../docs/config-reference.md).

### `GET /__rilot/carbon`

The signals this deployment is routing on, straight from KV and the provider:

```bash
curl "https://rilot-edge.<your-subdomain>.workers.dev/__rilot/carbon"
curl "https://rilot-edge.<your-subdomain>.workers.dev/__rilot/carbon?regions=eu-west-1"
```

Read-only, CORS-enabled, cached for half of `max_age_seconds`, and it never
exposes `ELECTRICITYMAP_API_KEY`. It is what `examples/demo-shop` reads when
`PUBLIC_CARBON_API` is set.

## Carbon flow

1. Fresh signal in the isolate's memory → used directly.
2. Otherwise Workers KV (`carbon:<region>`); if within `max_age_seconds` it is used as last-known-good.
3. Otherwise the provider is called (bounded by `provider_timeout_ms`), and results are written back to memory and KV (`ctx.waitUntil`).
4. If nothing usable is found, the backend is reported as `carbon-unavailable` and the configured `fallback` applies.

Carbon is requested only for regions that survived the radius and constraint checks, and not at all for a `latency` policy.

The rules above live in the shared carbon layer, not in this adapter. To add a new carbon source, see [docs/carbon-layer.md](../../docs/carbon-layer.md).

## Tests

```bash
npm test        # runs inside workerd via @cloudflare/vitest-pool-workers
```

Covers request metadata, rule inheritance, carbon skipping, KV last-known-good, KV persistence, fallback and error paths. The engine itself is covered by the shared fixtures in `fixtures/decisions/` (`cargo test`, `scripts/check-wasm-fixtures.mjs`).

## Known limitations

- **Hysteresis is per isolate.** Cloudflare runs many isolates, so stickiness is not global. A Durable Object would be needed for that.
- **No deferral sleep.** A `deferred-for-greener-window` decision is reported via `x-rilot-defer-seconds`; the Worker does not delay the request.
- **No Prometheus endpoint.** Native Rilot exposes `/metrics`; here, use Workers Analytics or `console.log` output in `wrangler tail`.
- `compatibility_flags = ["nodejs_compat"]` is required by the Workers Vitest pool.
