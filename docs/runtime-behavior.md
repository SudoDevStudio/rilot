# Runtime Behavior (Carbon Cursor)

## Decision pipeline

1. Route match
2. Route classification
3. Candidate preselection
4. Signal read (cache first)
5. Constraint filtering
6. Scoring
7. Hysteresis/stickiness
8. Optional plugin override
9. Forward request
10. Metrics/log updates

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

Cross-region penalty behavior:

- `constraints.cross_region_rtt_penalty_ms` is always applied in scoring when request region differs from selected region.
- If `RILOT_EMULATE_CROSS_REGION_RTT=true`, the same penalty is also applied to actual forwarded request latency (sleep before upstream call), so measured p95 latency reflects cross-region routing choices.

Priority modes:

- `latency-first`
- `carbon-first`
- `balanced` (uses explicit weights)
- If eligible zones have equal carbon values, Rilot uses zone order from config (`zones[]`) as deterministic tie-breaker.

## Time shifting

When enabled for `background` traffic:

- Compare current vs forecast signal.
- If forecast improvement exceeds threshold, mark decision as deferred.
- Delay is capped by `max_defer_seconds`.

## Fail-safe behavior

- Missing carbon signals: route by lowest latency within constraints.
- No eligible candidate: optional fail-safe lowest-latency fallback.

## Plugin integration

Plugin can:

- override upstream URL
- mutate headers
- override energy/carbon values for accounting

Plugin cannot run indefinitely (`plugin_timeout_ms`).

## Observability

- Prometheus endpoint (`/metrics`)
- Structured decision logs (sampled + always on errors)
- Periodic rollup logs per route
- Optional research headers are emitted only when `RILOT_EXPOSE_RESEARCH_HEADERS=true`:
- `x-rilot-cc-ttl-left` selected-zone cache TTL remaining.
- `x-rilot-selected-zone` selected zone name.
- `x-rilot-selected-carbon-intensity` selected-zone carbon intensity signal.
- `x-rilot-carbon-saved-vs-worst` selected carbon savings vs highest-carbon eligible zone.
- `x-rilot-decision-reason` short reason such as `score-win`, `fallback-lowest-latency`, or guardrail/stability reason.
