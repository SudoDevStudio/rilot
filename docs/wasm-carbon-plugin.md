# Writing a Carbon-Aware Wasm Plugin

Rilot supports a per-route Wasm override (`override_file`) that can replace target backend URLs and mutate headers.

## Input contract (stdin JSON)

```json
{
  "method": "GET",
  "path": "/product/123",
  "headers": {"x-user-region":"us-east"},
  "body": ""
}
```

## Output contract (stdout JSON)

```json
{
  "app_url": "http://us-west:5678",
  "headers_to_update": {"x-carbon-policy":"carbon-first"},
  "headers_to_remove": ["x-debug"],
  "energy_joules_override": 12.4,
  "carbon_intensity_g_per_kwh_override": 210.0,
  "energy_source": "tenant-meter-v2"
}
```

`energy_joules_override` is the main extension point for tenant-provided energy models.  
When present, Rilot uses this value for per-request CO2e accounting instead of host-side estimation.

## Runtime guardrails

- Plugin execution can be disabled per route with `plugin_enabled=false`.
- `strict-local` class bypasses plugins.
- Plugin calls run with `plugin_timeout_ms` budget.

## Typical plugin pattern

1. Read request context from stdin.
2. Query a carbon data source via WASI HTTP.
3. Compute route score (carbon, latency, errors, cost) for candidate backends.
4. Return selected backend in `app_url`.

Use `examples/` as the starting template for building a custom component.
