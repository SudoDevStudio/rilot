# Runtime Behavior (Carbon Cursor)

All routing behavior below is implemented once, in `crates/rilot-core/src/decision.rs`, and is shared by the native proxy, edge adapters, and the browser playground.

## Decision pipeline

1. **Resolve rule**: the most specific `routing_rules[].path` wins (exact beats wildcard, then the longer prefix); unset values inherit from the root.
2. **Apply hints**: `x-rilot-class`, `x-rilot-carbon-cursor`, `x-rilot-forecasting`, `x-rilot-time-shift`.
3. **Scope**: the rule's `backends` (or all root backends).
4. **Strict-local** (`advanced.route_class: "strict-local"`): keep only backends in the user's region, if any exist.
5. **Radius**: reject backends farther than `radius_km` from the user. It is skipped (and reported as `radius_applied: false`) when the user location is unknown.
6. **Candidate limit** (`advanced.max_candidates`): keep the N best-placed candidates (local first, then fastest).
7. **Constraints**: health (`healthy: false`, `max_error_rate`) and capacity (`max_in_flight`, `max_request_share_percent`) first; then latency (`hard_max_latency_ms`, and `max_latency_delta_ms` measured from the fastest healthy, unsaturated candidate).
8. **Carbon**: this step runs only if the policy weights carbon. Backends without a fresh signal are rejected as `carbon-unavailable`. With `min_carbon_benefit_g_per_kwh`, backends that are not meaningfully cleaner than the lowest-latency candidate are rejected.
9. **Score** eligible backends and pick the lowest score (ties go to config order).
10. **Hysteresis**: keep the previous backend if the new winner improves the score by less than `hysteresis_delta` within `min_switch_interval_secs`.
11. **Fallback** if nothing is eligible.
12. **Deferral** for background requests whose forecast is sufficiently cleaner.

Steps 1–7 are exposed as `plan()`, which also returns the regions that need carbon data. The native adapter fetches carbon only for those regions, and not at all for `latency` policies.

## Candidate eligibility

Every candidate is reported with one status: `eligible`, `rejected`, `selected`, or `fallback`. A rejected candidate also carries one or more rejections:

| Kind | Meaning |
| --- | --- |
| `outside-radius` | farther than `radius_km`, or region location unknown |
| `region-constraint` | strict-local route, backend outside the user's region |
| `candidate-limit` | beyond `max_candidates` |
| `health-constraint` | marked unhealthy or error rate above `max_error_rate` |
| `capacity-constraint` | in-flight limit or request-share cap reached |
| `latency-constraint` | above `hard_max_latency_ms` or `max_latency_delta_ms` |
| `carbon-unavailable` | carbon needed but no signal, or the signal is older than `max_age_seconds` |
| `insufficient-carbon-benefit` | not cleaner than the latency baseline by `min_carbon_benefit_g_per_kwh` |

## Latency estimate

Per backend, the first available of:

1. measured latency (adapter runtime input),
2. `rtt_ms` + `cross_region_rtt_penalty_ms` if the user region differs (legacy `base_rtt_ms`),
3. `5 ms + 0.015 ms/km × distance` from the region catalog,
4. `20 ms` (+ cross-region penalty).

If `RILOT_EMULATE_CROSS_REGION_RTT=true`, the native proxy also sleeps the cross-region penalty before forwarding, so measured tail latency reflects cross-region choices.

## Scoring

Each metric is divided by its maximum among eligible candidates (0..1), weighted, and summed. **Lower score wins.**

| Policy | carbon | latency | reliability | cost |
| --- | --- | --- | --- | --- |
| `latency` | 0 | 1 | 0 | 0 |
| `balanced` | 0.50 | 0.35 | 0.15 | 0 |
| `carbon` | 0.70 | 0.20 | 0.10 | 0 |

`advanced.weights` replaces the preset for `balanced`/`carbon` (weights are normalized to sum to 1). `latency` is always pure latency and never needs carbon data. `advanced.carbon_aware: false` (legacy `carbon_cursor_enabled: false`) forces `latency`.

Error rates come from a recent per-backend request window, not lifetime totals, so a backend that has recovered can become eligible again.

## Signal freshness and caching (native)

- `CarbonService` serves cached signals younger than `refresh_seconds`.
- A cached signal that is due for refresh but still within `max_age_seconds` is served while a background refresh runs.
- A missing or too-old signal is fetched synchronously, bounded by `provider_timeout_ms`.
- On provider failure the last known value is passed through. The core rejects it as `carbon-unavailable` once it is older than `max_age_seconds`.

## Time shifting

Deferral applies only when the policy uses carbon, `route_class == "background"`, `forecasting == true`, and `time_shift == true`. Scoring then uses the forecast value. If the forecast is at least `forecast_min_improvement_ratio` cleaner than now, the decision reason is `deferred-for-greener-window` and the native proxy waits up to `max_defer_seconds`.

## Fallback

When no candidate is eligible, `fallback` decides:

- `nearest` (default): the geographically nearest healthy backend in scope (lowest latency if the user location is unknown),
- `lowest-latency`: the lowest-latency healthy backend in scope,
- `none`: no selection (native proxy returns `503`).

## Decision reasons

`score-win`, `lowest-latency`, `hysteresis-sticky-zone`, `deferred-for-greener-window`, `fallback-nearest`, `fallback-lowest-latency`, `no-eligible-backend`, `no-backends`.

## Plugin integration

Plugin can:

- override upstream URL
- mutate headers
- override energy/carbon values for accounting

Plugin cannot run indefinitely (`plugin_timeout_ms`).
Plugin does not inherit host process args or env by default.

## Observability

- Prometheus endpoint (`/metrics`), labelled by route (rule path; legacy `rule.path`; `*` for unmatched) and backend id
- Structured decision logs (sampled + always on errors), including matched rule, policy, reason, and fallback flag
- Periodic rollup logs per route
- Optional research headers are emitted only when `RILOT_EXPOSE_RESEARCH_HEADERS=true`:
- `x-rilot-cc-ttl-left` seconds until the selected backend's carbon signal is refreshed.
- `x-rilot-selected-zone` selected backend id.
- `x-rilot-selected-carbon-intensity` selected backend carbon intensity signal.
- `x-rilot-zone-carbon-intensity-g-per-kwh` snapshot of all candidate carbon values (`na` when not fetched).
- `x-rilot-eligible-zone-carbon-intensity-g-per-kwh` snapshot of only eligible candidates.
- `x-rilot-zone-filter-reasons` `id:eligible` or `id:<rejection kind>` per candidate.
- `x-rilot-carbon-saved-vs-worst` selected carbon savings vs the highest-carbon eligible backend.
- `x-rilot-carbon-saved-vs-worst-percent` the same as a percentage.
- `x-rilot-decision-reason` decision reason code (see above).
