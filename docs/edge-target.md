# Edge-Wasm Target Plan

Rilot currently runs as a native server host and executes Wasm plugins.

This project now includes a scaffold (`adapters/edge-wasm/`) for a future edge deployment mode where:

- routing logic is shared through `crates/rilot-core`
- platform adapter translates requests/responses
- decision path remains cache-first and policy-driven

## What exists today

- `crates/rilot-core`: reusable policy primitives (`classify_route`, `effective_weights`)
- `adapters/edge-wasm`: placeholder adapter skeleton and WIT contract draft

## What still needs implementation

1. Pick target edge provider/runtime.
2. Implement adapter request normalization and backend forwarding.
3. Integrate provider-specific observability hooks.
4. Add runtime conformance tests.
