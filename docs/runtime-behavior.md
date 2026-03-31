# Runtime Behavior (Carbon Cursor)

## Decision pipeline

1. Route match
2. Route classification
3. Candidate preselection
4. Per-candidate signal read (cache first, async refresh if stale)
5. Per-candidate constraint filtering
6. Carbon tie-break or weighted scoring
7. Fail-safe lowest-latency fallback if needed
8. Hysteresis/stickiness
9. Optional defer-for-greener-window (`background` routes only)
10. Optional plugin override
11. Forward request
12. Metrics/log updates

## Candidate preselection

Candidates are trimmed before scoring using:

- `zone_allowlist` (zone/region/tag)
- region affinity (`x-user-region`)
- `max_candidates`

This limits computation and keeps routing latency stable.

## Signal cache and refresh

- Request path reads cached carbon/forecast signals.
- If stale/missing, Rilot triggers async refresh.
- Provider timeout does not block request path.
- Cached/default values are used as fallback.

## Scoring

Normalized weighted score over:

- Carbon intensity
- Latency estimate
- Error rate
- Cost weight

Lower score wins.

Error-rate guardrails use a recent per-zone request window rather than lifetime cumulative errors, so recovered zones can re-enter consideration after sustained healthy traffic.

Cross-region penalty behavior:

- `constraints.cross_region_rtt_penalty_ms` is always applied in scoring when request region differs from selected region.
- If `RILOT_EMULATE_CROSS_REGION_RTT=true`, the same penalty is also applied to actual forwarded request latency (sleep before upstream call), so measured p95 latency reflects cross-region routing choices.

Priority modes:

- `latency-first`
- `carbon-first`
- `balanced` (uses built-in balanced weights unless explicit `weights` are supplied)
- `custom` (use explicit `weights` without implying a built-in preset)
- When `policy.weights` is provided, those explicit weights override any built-in `priority_mode` preset.
- If eligible zones have equal carbon values, Rilot uses zone order from config (`zones[]`) as deterministic tie-breaker.

## Time shifting

Time shifting only activates when all of the following are true:

- `carbon_cursor_enabled=true`
- `forecasting_enabled=true`
- `time_shift_enabled=true`
- `route_class == "background"`
- `forecast_window_minutes > 0`

When those conditions hold:

- Compare current vs forecast signal.
- If forecast improvement exceeds threshold, mark decision as deferred.
- Delay is capped by `max_defer_seconds`.

## Fail-safe behavior

- Missing carbon signals: route by lowest latency within constraints.
- No eligible candidate: optional fail-safe lowest-latency fallback.
- If all candidates are filtered only by `max_request_share_percent`, Rilot relaxes that cap before falling back so the request path can continue.

## Plugin integration

Plugin can:

- override upstream URL
- mutate headers
- override energy/carbon values for accounting

Plugin cannot run indefinitely (`plugin_timeout_ms`).
Plugin does not inherit host process args or env by default.

## Observability

- Prometheus endpoint (`/metrics`)
- Structured decision logs (sampled + always on errors)
- Periodic rollup logs per route
- Optional research headers are emitted only when `RILOT_EXPOSE_RESEARCH_HEADERS=true`:
- `x-rilot-cc-ttl-left` selected-zone cache TTL remaining.
- `x-rilot-selected-zone` selected zone name.
- `x-rilot-selected-carbon-intensity` selected-zone carbon intensity signal.
- `x-rilot-zone-carbon-intensity-g-per-kwh` snapshot of all candidate zone carbon values.
- `x-rilot-eligible-zone-carbon-intensity-g-per-kwh` snapshot of only eligible candidate zone carbon values.
- `x-rilot-zone-filter-reasons` snapshot of why each zone was eligible or filtered.
- `x-rilot-carbon-saved-vs-worst` selected carbon savings vs highest-carbon eligible zone.
- `x-rilot-carbon-saved-vs-worst-percent` selected carbon savings percentage vs highest-carbon eligible zone.
- `x-rilot-decision-reason` short reason such as `score-win`, `fallback-lowest-latency`, or guardrail/stability reason.
