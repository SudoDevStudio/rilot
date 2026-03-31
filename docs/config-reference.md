# Config Reference

Unless noted otherwise, omitted fields use the runtime defaults from [`src/config.rs`](../src/config.rs).

## Important defaults

These are the defaults most users are likely to rely on implicitly:

| Field | Default |
| --- | --- |
| `metrics.enabled` | `true` |
| `metrics.path` | `"/metrics"` |
| `metrics.decision_log_sample_rate` | `0.01` |
| `metrics.rollup_interval_secs` | `60` |
| `carbon.provider` | `"mock"` |
| `carbon.cache_ttl_seconds` | `60` |
| `carbon.provider_timeout_ms` | `75` |
| `carbon.default_carbon_intensity` | `450.0` |
| `carbon.carbon_safe_threshold_g_per_kwh` | `300.0` |
| `carbon.electricitymap_base_url` | `"https://api.electricitymap.org"` |
| `carbon.electricitymap_api_token_header` | `"auth-token"` |
| `rule.type` | `"prefix"` |
| `rewrite` | `"none"` |
| `policy.route_class` | `"flexible"` |
| `policy.priority_mode` | `"balanced"` |
| `policy.carbon_cursor_enabled` | `false` |
| `policy.forecasting_enabled` | `false` |
| `policy.time_shift_enabled` | `false` |
| `policy.plugin_enabled` | `true` |
| `policy.fail_safe_lowest_latency` | `true` |
| `policy.forecast_window_minutes` | `30` |
| `policy.forecast_min_improvement_ratio` | `0.10` |
| `policy.max_defer_seconds` | `0` |
| `policy.hysteresis_delta` | `0.05` |
| `policy.min_switch_interval_secs` | `30` |
| `policy.plugin_timeout_ms` | `800` |
| `constraints.max_candidates` | `8` |
| `constraints.cross_region_rtt_penalty_ms` | `40.0` ms when unset |
| `zones[].base_rtt_ms` | `35.0` |
| `zones[].region` | falls back to `zones[].name` |
| `zones[].cost_weight` | `0.0` |
| `zones[].max_in_flight` | no capacity cap |
| `zones[].tags` | `[]` |

## Top-level

- `metrics.enabled` (bool): enable `/metrics` endpoint. Default `true`.
- `metrics.path` (string): metrics HTTP path. Default `"/metrics"`.
- `metrics.decision_log_sample_rate` (float 0..1): full decision log sampling rate. Default `0.01`.
- `metrics.rollup_interval_secs` (u64): periodic rollup log interval. Default `60`.

- `carbon.provider` (string): `mock`, `slow-mock`, `electricitymap`, `electricitymap-local`, or custom future provider. Default `"mock"`.
- `carbon.cache_ttl_seconds` (u64): signal TTL per zone, in seconds (default `60`).
- `carbon.provider_timeout_ms` (u64): timeout for provider refresh calls. Default `75`.
- `carbon.default_carbon_intensity` (float): fallback intensity. Default `450.0`.
- `carbon.carbon_safe_threshold_g_per_kwh` (float): threshold used to count carbon-safe calls. Default `300.0`.
- `carbon.zone_current` (map zone->float): current intensity seed/fallback. Default `{}`.
- `carbon.zone_forecast_next` (map zone->float): forecast seed/fallback. Default `{}`.

ElectricityMap fields:

- `carbon.electricitymap_base_url` (string): default `https://api.electricitymap.org`.
- `carbon.electricitymap_api_key` (string|null): API token for ElectricityMap.
- `carbon.electricitymap_api_token_header` (string): auth header name, default `auth-token`.
- `carbon.electricitymap_zone_map` (map route-zone->electricitymap-zone): optional mapping when names differ.
- `carbon.electricitymap_disable_estimations` (bool): pass through to ElectricityMap latest endpoint query.
- `carbon.electricitymap_local_fixture` (string|null): path to local JSON fixture for offline testing (`electricitymap-local` mode).
- `carbon.electricitymap_local_live_reload` (bool): when `true`, local fixture is read every request (no cache). Default `false` uses local TTL cache.

Runtime env toggles (not config-file fields):

- `RILOT_HOST` (string): bind host for the proxy server. Default `127.0.0.1`.
- `RILOT_PORT` (u16): bind port for the proxy server. Default `8080`.
- `RILOT_ENV` (string): when set to `production`, Rilot preloads Wasm components into the cache on startup.
- `RILOT_EXPOSE_RESEARCH_HEADERS` (bool): when `true`, Rilot emits research/debug headers such as selected zone, carbon snapshots, and decision reason.
- `RILOT_EMULATE_CROSS_REGION_RTT` (bool): when `true`, Rilot adds the configured `cross_region_rtt_penalty_ms` to observed request latency for cross-region selections. Useful for research runs where tail latency must reflect cross-region routing decisions.

- `proxies` (array): route definitions.

## `proxies[]`

- `app_name` (string): logical name.
- `app_uri` (string): default upstream URI.
- `override_file` (string|null): Wasm component path.
- `rewrite` (string): `none` or `strip`. Default `none`.
- `rule.path` (string): route match path. Must be unique across `proxies[]`.
- `rule.type` (string): `exact` or `prefix`. Default `prefix`. Legacy `contain` is accepted as a backward-compatible alias for `prefix`.
- `zones` (array): candidate upstream zones.
- `policy` (object): Carbon Cursor controls.

## `zones[]`

- `name` (string): unique zone identifier.
- `region` (string, optional): region label used with `x-user-region`. If omitted, Rilot falls back to `name`.
- `app_uri` (string): upstream URI for zone.
- `base_rtt_ms` (float, optional): base latency estimate. If omitted, Rilot falls back to `35.0`.
- `cost_weight` (float, optional): relative cost weight. If omitted, Rilot falls back to `0.0`.
- `max_in_flight` (usize, optional): capacity guardrail. If omitted, no in-flight cap is enforced.
- `tags` (string[]): tag-based filtering. Default `[]`.

## `policy`

### Toggles

- `carbon_cursor_enabled` (bool): default `false`.
- `forecasting_enabled` (bool): default `false`.
- `time_shift_enabled` (bool): default `false`.
- `plugin_enabled` (bool): default `true`.

### Routing behavior

- `route_class` (string): `strict-local`, `flexible`, `background`. Default `flexible`.
- `priority_mode` (string): `balanced`, `latency-first`, `carbon-first`, or `custom`. Default `balanced`.
- `weights.w_carbon` / `weights.w_latency` / `weights.w_errors` / `weights.w_cost` (float): optional explicit weights. When provided, these take precedence over any built-in `priority_mode` preset. If a `weights` block is present but a field is omitted, its fallback is `0.5 / 0.35 / 0.15 / 0.0` respectively.

### Constraints

- `constraints.max_candidates` (usize): default `8`.
- `constraints.zone_allowlist` (string[]): zone names, region names, or `tag:<name>` entries. Default `[]`. Region-name entries are only considered on requests that include `x-user-region`; otherwise preselection falls back to the broader candidate set if no zone/tag entry matches.
- `constraints.max_added_latency_ms` (float)
- `constraints.cross_region_rtt_penalty_ms` (float): optional model penalty added when `x-user-region` and zone region differ. Default is `40` ms if unset.
- `constraints.p95_latency_budget_ms` (float)
- `constraints.max_error_rate` (float 0..1)
- `constraints.max_request_share_percent` (float 0..100): soft cap on historical per-route traffic share for a zone (e.g. `20` means no zone should exceed 20%). If all candidates are filtered only by this cap, Rilot relaxes the cap rather than failing the request path.

### Stability / safety

- `forecast_window_minutes` (u32): default `30`.
- `forecast_min_improvement_ratio` (float): default `0.10`.
- `max_defer_seconds` (u64): default `0`.
- `fail_safe_lowest_latency` (bool): default `true`.
- `hysteresis_delta` (float): default `0.05`.
- `min_switch_interval_secs` (u64): default `30`.
- `plugin_timeout_ms` (u64, default `800`)

## Header overrides

- `x-user-region`: caller region context.
- `x-rilot-class`: request route class override.
- `x-rilot-carbon-cursor`: `true`/`false`.
- `x-rilot-forecasting`: `true`/`false`.
- `x-rilot-time-shift`: `true`/`false`.
- `x-rilot-plugin`: `true`/`false`.
