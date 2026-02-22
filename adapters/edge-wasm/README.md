# Edge Adapter Scaffold

This folder scaffolds a future WebAssembly edge deployment target.

Current status:

- Not production-ready.
- Intended to host a platform-specific adapter (Cloudflare/Fastly/etc).
- Uses `rilot-core` as the shared routing decision engine.

## Design intent

1. Parse edge request into normalized policy inputs.
2. Call `rilot-core` for classification/weights/scoring primitives.
3. Map selected backend to platform-specific fetch/forward APIs.
4. Emit decision metadata for observability.

## Next implementation steps

- Add concrete adapter for one provider runtime.
- Replace placeholder WIT/API with real edge host bindings.
- Add integration tests against `examples/node-apps`.
