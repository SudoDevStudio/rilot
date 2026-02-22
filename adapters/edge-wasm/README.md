# Edge Adapter Roadmap

This folder captures the planned WebAssembly edge deployment target.

Positioning for the paper:

- This is a future-work track for provider-native edge execution.
- It is intended to host a platform-specific adapter (Cloudflare/Fastly/etc).
- It uses `rilot-core` as the shared routing decision engine.

## Design intent

1. Parse edge request into normalized policy inputs.
2. Call `rilot-core` for classification/weights/scoring primitives.
3. Map selected backend to platform-specific fetch/forward APIs.
4. Emit decision metadata for observability.

## Planned implementation steps

- Add concrete adapter for one provider runtime.
- Replace draft WIT/API with provider host bindings.
- Add integration tests against `examples/node-apps`.
