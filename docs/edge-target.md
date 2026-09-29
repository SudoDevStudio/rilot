# Edge Target

Rilot runs at the edge through two adapters — [`adapters/cloudflare`](../adapters/cloudflare) (a Worker) and [`adapters/vercel`](../adapters/vercel) (an Edge Function) — both executing `crates/rilot-core` compiled to WebAssembly, so edge routing decisions are identical to native ones and to each other.

```text
request ─▶ plan() ─▶ carbon regions ─▶ CarbonService (memory → Workers KV → provider)
                                                  │
       fetch(backend) ◀── DecisionOutput ◀── decide()
```

## Division of responsibility

| Layer | Owns |
| --- | --- |
| `crates/rilot-core` | routing rules, radius, constraints, scoring, fallback, hysteresis |
| `packages/rilot-js` | the shared TypeScript binding for the Wasm module (also used by the playground) |
| `packages/rilot-http` | endpoints, request context, decision sequence, forwarding, research headers — shared by every JavaScript adapter |
| `adapters/cloudflare` | Worker runtime, `cf` metadata, Workers KV cache, `ctx.waitUntil` |
| `adapters/vercel` | Edge Function runtime, `x-vercel-ip-*` metadata, Vercel KV over REST |

The core never performs I/O and never sees provider-specific zone ids.

## What exists today

- A deployable Worker (`npm run deploy`) with `/__rilot/health` and `/__rilot/decision` endpoints for testing a deployment without real backends.
- Carbon acquisition with a per-isolate cache, Workers KV last-known-good storage, and Electricity Maps / JSON / static providers.
- Tests that run in `workerd` (`npm test`), plus the shared decision fixtures that keep native, Wasm, and browser results identical.

See the [adapter README](../adapters/cloudflare/README.md) for setup, deployment, and limitations (hysteresis is per isolate; there is no `/metrics` endpoint at the edge).

## Future work

- Durable Object (or KV) backed hysteresis state so stickiness is global.
- Analytics Engine export to match native Prometheus metrics.
- Adapters for other edge runtimes, reusing `packages/rilot-js`.
