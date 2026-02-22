# Config Reference

## Top-level

- `metrics.enabled` (bool): enable `/metrics` endpoint.
- `metrics.path` (string): metrics HTTP path.
- `metrics.decision_log_sample_rate` (float 0..1): full decision log sampling rate.
- `metrics.rollup_interval_secs` (u64): periodic rollup log interval.

- `carbon.provider` (string): `mock`, `slow-mock`, `electricitymap`, `electricitymap-local`, or custom future provider.
- `carbon.cache_ttl_minutes` (u64): signal TTL per zone, in minutes.
- `carbon.provider_timeout_ms` (u64): timeout for provider refresh calls.
- `carbon.default_carbon_intensity` (float): fallback intensity.
- `carbon.zone_current` (map zone->float): current intensity seed/fallback.
- `carbon.zone_forecast_next` (map zone->float): forecast seed/fallback.

ElectricityMap fields:

- `carbon.electricitymap_base_url` (string): default `https://api.electricitymap.org`.
- `carbon.electricitymap_api_key` (string|null): API token for ElectricityMap.
- `carbon.electricitymap_api_token_header` (string): auth header name, default `auth-token`.
- `carbon.electricitymap_zone_map` (map route-zone->electricitymap-zone): optional mapping when names differ.
- `carbon.electricitymap_disable_estimations` (bool): pass through to ElectricityMap latest endpoint query.
- `carbon.electricitymap_local_fixture` (string|null): path to local JSON fixture for offline testing (`electricitymap-local` mode).

- `proxies` (array): route definitions.

## `proxies[]`

- `app_name` (string): logical name.
- `app_uri` (string): default upstream URI.
- `override_file` (string|null): Wasm component path.
- `rewrite` (string): `none` or `strip`.
- `rule.path` (string): route match path.
- `rule.type` (string): `exact` or `contain`.
- `zones` (array): candidate upstream zones.
- `policy` (object): Carbon Cursor controls.

## `zones[]`

- `name` (string): unique zone identifier.
- `region` (string): region label used with `x-user-region`.
- `app_uri` (string): upstream URI for zone.
- `base_rtt_ms` (float): base latency estimate.
- `cost_weight` (float): optional relative cost weight.
- `max_in_flight` (usize): capacity guardrail.
- `tags` (string[]): tag-based filtering.

## `policy`

### Toggles

- `carbon_cursor_enabled` (bool)
- `forecasting_enabled` (bool)
- `time_shift_enabled` (bool)
- `plugin_enabled` (bool)

### Routing behavior

- `route_class` (string): `strict-local`, `flexible`, `background`.
- `priority_mode` (string): `balanced`, `latency-first`, `carbon-first`.
- `weights.w_carbon` / `weights.w_latency` / `weights.w_errors` / `weights.w_cost` (float)

### Constraints

- `constraints.max_candidates` (usize)
- `constraints.zone_allowlist` (string[]): zone names, region names, or `tag:<name>` entries.
- `constraints.max_added_latency_ms` (float)
- `constraints.p95_latency_budget_ms` (float)
- `constraints.max_error_rate` (float 0..1)

### Stability / safety

- `forecast_window_minutes` (u32)
- `forecast_min_improvement_ratio` (float)
- `max_defer_seconds` (u64)
- `fail_safe_lowest_latency` (bool)
- `hysteresis_delta` (float)
- `min_switch_interval_secs` (u64)
- `plugin_timeout_ms` (u64)

## Header overrides

- `x-user-region`: caller region context.
- `x-rilot-class`: request route class override.
- `x-rilot-carbon-cursor`: `true`/`false`.
- `x-rilot-forecasting`: `true`/`false`.
- `x-rilot-time-shift`: `true`/`false`.
- `x-rilot-plugin`: `true`/`false`.
