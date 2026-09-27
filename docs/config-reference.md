# Config Reference

Rilot accepts two config formats. Both are compiled into the same `rilot-core` routing config and run through the same decision engine.

- **Simple config** (recommended): `backends`, `policy`, `radius_km`, `fallback`, `routing_rules`.
- **Legacy `proxies` config**: still loaded, and translated automatically (see the end of this page).

A document containing a top-level `proxies` key is treated as legacy.

## Simple config

```json
{
  "carbon": {
    "provider": "electricitymap",
    "max_age_seconds": 300
  },

  "backends": [
    { "id": "east", "region": "us-east-1", "url": "https://east.example.com" },
    { "id": "west", "region": "us-west-2", "url": "https://west.example.com" }
  ],

  "policy": "balanced",
  "radius_km": 2000,
  "fallback": "nearest",

  "routing_rules": [
    { "path": "/checkout/*", "policy": "latency", "radius_km": 800 }
  ]
}
```

A request to `/checkout/pay` resolves to:

```text
Matched rule:  /checkout/*
policy   = latency   (rule)
radius   = 800 km    (rule)
fallback = nearest   (inherited from root)
backends = east, west (inherited from root)
```

### Root fields

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `backends` | array | required | Candidate backends (at least one). |
| `policy` | `latency` \| `balanced` \| `carbon` | `balanced` | Routing objective. `latency-first`, `carbon-first`, and `custom` are accepted as aliases. |
| `radius_km` | number \| omitted | unlimited | Maximum user→backend distance. |
| `fallback` | `nearest` \| `lowest-latency` \| `none` | `nearest` | What to do when no backend is eligible. |
| `routing_rules` | array | `[]` | Per-path overrides. |
| `advanced` | object | `{}` | Research knobs (see below). Normal configs don't need these. |

### `backends[]`

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Unique id (used in metrics, logs, and rules). |
| `region` | yes | Canonical region, e.g. `us-east-1`, `europe-west4`, `westeurope`. Carbon signals are requested for this region. |
| `url` | yes (native) | Upstream base URL. |
| `location` | no | `{ "lat", "lon" }`, only for regions missing from the built-in catalog. |
| `rtt_ms`, `cost`, `max_in_flight`, `carbon_region` | no | Advanced: configured RTT, relative cost, in-flight cap, alternative carbon signal key. |

No Electricity Maps zones, coordinates, provider endpoints, or cache settings are needed for catalog regions.

### `routing_rules[]`

| Field | Meaning |
| --- | --- |
| `path` | `/checkout/*` matches `/checkout` and everything below it. `/reports*` is a plain prefix. No `*` means an exact match. |
| `policy`, `fallback` | Override; omitted → inherited. |
| `radius_km` | Number overrides, `null` means unlimited, omitted → inherited. |
| `backends` | Subset of root backend ids; omitted → all root backends. |
| `advanced` | Field-by-field override of root `advanced`. |

The most specific rule wins: an exact match beats a wildcard, then the longer prefix wins, then the earlier rule. Paths must be unique. Unmatched requests use the root settings.

### `advanced` (research controls)

| Field | Default | Meaning |
| --- | --- | --- |
| `weights` | policy preset | `{carbon, latency, reliability, cost}`; normalized to sum to 1. Ignored for `latency`. |
| `carbon_aware` | `true` | `false` forces the `latency` policy. |
| `route_class` | `flexible` | `flexible`, `strict-local`, `background`. |
| `max_latency_delta_ms` | none | Reject backends slower than the fastest candidate by more than this. |
| `hard_max_latency_ms` | none | Reject backends above this latency. |
| `min_carbon_benefit_g_per_kwh` | none | Non-baseline backends must be at least this much cleaner than the lowest-latency candidate. |
| `max_error_rate` | none | Health threshold (0..1). |
| `max_request_share_percent` | none | Capacity cap on a backend's share of route traffic. |
| `max_candidates` | none | Consider only the N best-placed backends. |
| `hysteresis_delta` | `0.05` | Minimum score improvement needed to switch backends. |
| `min_switch_interval_secs` | `30` | Hysteresis window. |
| `forecasting`, `time_shift` | `false` | Enable forecast-based deferral (background routes). |
| `forecast_min_improvement_ratio` | `0.10` | Forecast improvement needed to defer. |
| `max_defer_seconds` | `0` | Maximum deferral. |
| `cross_region_rtt_penalty_ms` | `40` | Added to `rtt_ms`-based estimates for cross-region traffic. |

See [runtime-behavior.md](runtime-behavior.md) for exactly how each value is used.

## `carbon` (adapter-owned)

| Field | Default | Meaning |
| --- | --- | --- |
| `provider` | `mock` | `mock`, `static`, `slow-mock`, `json`, `electricitymap`, `electricitymap-local`. |
| `max_age_seconds` | `300` | Signals older than this are not used for routing. |
| `refresh_seconds` | `min(60, max_age_seconds)` | Background refresh interval. Legacy name: `cache_ttl_seconds`. |
| `provider_timeout_ms` | `75` | Bound on synchronous provider calls. |
| `json_source` | — | `json` provider: file path or http(s) URL (see below). |
| `zone_current`, `zone_forecast_next` | `{}` | `mock`/`static` values keyed by region. |
| `default_carbon_intensity` | none (legacy: `450`) | Mock/seed value for regions without an entry. Simple configs never invent carbon values unless this is set. |
| `carbon_safe_threshold_g_per_kwh` | `300` | Threshold for the `carbon_safe_calls_total` metric. |
| `electricitymap_api_key` | — | Prefer the `RILOT_ELECTRICITYMAP_API_KEY` environment variable. |
| `electricitymap_zone_map` | `{}` | Optional override of the provider's built-in region → zone mapping. |
| `electricitymap_base_url`, `electricitymap_api_token_header`, `electricitymap_disable_estimations` | | Electricity Maps API details. |
| `electricitymap_local_fixture`, `electricitymap_local_live_reload` | | Offline Electricity Maps fixture (`electricitymap-local`). |

Providers, caches, and how to add a new source: [carbon-layer.md](carbon-layer.md).

Generic JSON provider format. It is keyed by Rilot region and has no provider-specific ids:

```json
{
  "signals": [
    { "region": "us-east-1", "carbon_g_per_kwh": 245, "observed_at": "2026-09-18T20:00:00Z" },
    { "region": "us-west-2", "carbon_g_per_kwh": 118, "observed_at": "2026-09-18T20:00:00Z", "forecast_g_per_kwh": 100 }
  ]
}
```

## `metrics`

- `metrics.enabled` (bool): enable `/metrics` endpoint. Default `true`.
- `metrics.path` (string): metrics HTTP path. Default `"/metrics"`.
- `metrics.decision_log_sample_rate` (float 0..1): full decision log sampling rate. Default `0.01`.
- `metrics.rollup_interval_secs` (u64): periodic rollup log interval. Default `60`.

## Runtime environment toggles

- `RILOT_HOST` (string): bind host for the proxy server. Default `127.0.0.1`.
- `RILOT_PORT` (u16): bind port for the proxy server. Default `8080`.
- `RILOT_ENV` (string): when set to `production`, Rilot preloads Wasm components into the cache on startup.
- `RILOT_ELECTRICITYMAP_API_KEY` (string): Electricity Maps API key.
- `RILOT_EXPOSE_RESEARCH_HEADERS` (bool): emit research/debug headers (selected backend, carbon snapshots, filter and decision reasons).
- `RILOT_EMULATE_CROSS_REGION_RTT` (bool): add `cross_region_rtt_penalty_ms` to observed latency for cross-region selections.

## Request headers

- `x-user-region`: caller's canonical region (for example `us-east-1`); used for radius, strict-local, and latency estimates.
- `x-user-location`: precise caller location as `<lat>,<lon>` (for example `51.5,-0.13`). Takes precedence over `x-user-region` for distance, and over the CDN's own geolocation on edge adapters. An unparseable value is ignored (treated as "location unknown"), never an error.
- `x-user-lat`, `x-user-lon`: the same thing as two separate headers.
- `x-rilot-policy`: policy for this one request (`latency`, `balanced`, `carbon`). It beats the matched rule and the root config, and the decision reports `policy_source: "request"`. An unknown value is ignored.
- `x-rilot-class`: route class override (`flexible`, `strict-local`, `background`).
- `x-rilot-carbon-cursor`: `true`/`false` (overrides `advanced.carbon_aware`).
- `x-rilot-forecasting`: `true`/`false`.
- `x-rilot-time-shift`: `true`/`false`.
- `x-rilot-plugin`: `true`/`false`.

## Session policy cookie

A site can let each visitor decide how its own pages are routed and keep that
choice in a cookie. Both adapters read it and apply it exactly like
`x-rilot-policy`, so no server-side session store is needed:

```http
Cookie: rilot_policy=/products/*:carbon,/checkout/*:latency
```

- One `pattern:policy` pair per route, comma separated; the value may be
  percent-encoded, as a browser will do with `/` and `*`.
- Patterns are matched with the **same specificity rules as `routing_rules`**:
  an exact path beats a wildcard, a longer literal prefix beats a shorter one,
  ties go to the first entry. The parsing and matching live in
  `crates/rilot-core/src/cookie.rs`, so every adapter agrees by construction.
- An explicit `x-rilot-policy` header wins over the cookie.
- Anything malformed, unknown, or longer than 4 KB is skipped rather than
  rejected: a cookie is attacker-controlled input and must never break routing.
- It can only choose between the three policies. It cannot widen a radius,
  reach a backend a rule excluded, or change any other setting — so a
  `latency` rule on `/checkout/*` stays as safe as it was.

`examples/demo-shop` writes this cookie from the **Policy** tab of its routing
panel, which is why a choice made in the demo is a choice a real deployment
would honour.

## Carbon API

Both adapters expose the signals they are routing on, read-only:

```bash
curl http://127.0.0.1:8080/__rilot/carbon                     # every backend region
curl http://127.0.0.1:8080/__rilot/carbon?regions=us-west-2   # just these
```

```json
{
  "max_age_seconds": 300,
  "asked_for": ["us-east-1", "us-west-2"],
  "missing": [],
  "signals": [
    {
      "region": "us-east-1",
      "carbon_g_per_kwh": 420.0,
      "observed_at": "2026-09-22T02:32:02Z",
      "source": "mock",
      "age_seconds": 0,
      "stale": false
    }
  ]
}
```

The values come from the shared carbon layer — memory, then the store (Workers
KV at the edge), then the provider — so calling this endpoint costs the same as
a routed request, and never exposes the provider's API key. `missing` lists
regions the provider had no value for. An unknown region in `?regions` is a
`400` that tells you the known ones. The response carries
`Access-Control-Allow-Origin: *`, because grid intensity is not user data.

## Legacy `proxies` format

Existing configs such as `examples/config/legacy-proxies.json` and `research-kit/config*.json` keep working. They are translated at load time:

| Legacy | Becomes |
| --- | --- |
| `proxies[]` | one `routing_rules[]` entry each; unmatched paths still return `404` |
| `rule.type: prefix` / `contain` | `path*` (prefix); `exact` stays exact |
| `zones[]` | root `backends[]` (`name` → `id`, `app_uri` → `url`, `base_rtt_ms` → `rtt_ms`, `cost_weight` → `cost`); carbon keyed by zone name |
| `constraints.zone_allowlist` | the rule's `backends` subset (names, regions, `tag:` entries) |
| `priority_mode` | `carbon-first` → `carbon`; `latency-first` → `balanced` with legacy weights `0.15/0.65/0.20`; others → `balanced` |
| `carbon_cursor_enabled: false` | `advanced.carbon_aware: false` (latency routing) |
| `fail_safe_lowest_latency` | `fallback: lowest-latency` (or `none`) |
| `max_added_latency_ms`, `p95_latency_budget_ms` | `max_latency_delta_ms`, `hard_max_latency_ms` |
| other `policy`/`constraints` fields | the matching `advanced` fields |
| `override_file`, `plugin_*`, `rewrite` | native per-rule extras (unchanged behavior) |

Metrics keep the legacy `rule.path` as the route label.

Behavior differences from earlier releases, which follow from sharing one engine:

- Rules are chosen by specificity, not by config order.
- If every candidate has the same carbon value, the winner is chosen by score rather than config order.
- When every candidate hits `max_request_share_percent`, the configured fallback applies (the cap is no longer silently relaxed).
- Carbon savings are measured against the dirtiest *eligible* backend.
- A carbon provider timeout makes the affected backends `carbon-unavailable` instead of scoring seeded defaults.
- `carbon_cursor_enabled: false` routes report `lowest-latency` instead of `fallback-lowest-latency`.
