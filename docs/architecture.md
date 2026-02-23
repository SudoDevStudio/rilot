# Architecture

## Goal

Rilot is a reverse proxy that performs per-request routing with carbon-aware policies while preserving latency and reliability guardrails.

## High-level components

- HTTP proxy server (`src/proxy.rs`)
- Config loader (`src/config.rs`)
- Wasm plugin runtime (`src/wasm_engine.rs`)
- Research kit (`research-kit/`)

## Request lifecycle

1. Match request to route rule (`exact` or `contain`).
2. Classify route behavior (`strict-local`, `flexible`, `background`) + per-request overrides.
3. Build bounded candidate set from route zones and allowlists/tags.
4. Read carbon signals from cache; trigger async refresh if stale.
5. Filter candidates with constraints (latency/error/capacity).
6. Score remaining candidates using multi-objective mode/weights.
7. Apply hysteresis to reduce route flapping.
8. Optional Wasm plugin step (time-bounded) to override target and energy signals.
9. Forward request to selected backend.
10. Record metrics and structured logs.

## Data and control separation

- Hot path avoids blocking provider fetches.
- Carbon provider refresh is asynchronous and cached.
- Plugin execution is optional and bounded by timeout.

## Region-first model

Rilot uses `x-user-region` and zone `region` metadata. No lat/lon is required.

## Safety posture

- Fail-safe to lowest-latency when carbon signals are unavailable.
- `strict-local` routes bypass plugin/time-shift behavior.
- Configurable logging sample rate to limit overhead.
