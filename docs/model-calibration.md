# Energy Model and CO2e Estimates

Rilot reports estimated energy and CO2e metrics to support comparative evaluation of routing policies.
These values are model outputs rather than direct power-meter measurements, so they are best interpreted as relative indicators unless calibrated against measured service energy.

## Current estimation model

Rilot emits two request-aggregated metrics:

1. `energy_joules_estimated`
2. `co2e_estimated_total`

By default, the proxy estimates per-request energy in `src/proxy.rs` as:

- `energy_joules = 0.003 * latency_ms + 0.00001 * bytes`

It then converts estimated energy to grams of CO2e using:

- `co2e_g = (energy_joules / 3_600_000) * carbon_intensity_g_per_kwh`

The carbon-intensity term comes from the configured provider signal (`electricitymap`, `electricitymap-local`, or mock inputs), unless a Wasm plugin supplies `carbon_intensity_g_per_kwh_override`.
Likewise, a plugin can replace the default energy estimate through `energy_joules_override`.

## Calibration workflow

To improve absolute accuracy for a specific service or deployment:

1. Collect measured service energy under representative load (for example via RAPL, smart PDU, cloud telemetry, or host power instrumentation).
2. Fit coefficients against measured joules per request for the service classes you care about.
3. Apply the calibrated model either by adjusting core estimation parameters or by using plugin overrides.
4. Evaluate both absolute error against measured data and relative ranking stability across policy modes.

## Interpretation notes

- Results are sensitive to the chosen proxy energy model coefficients.
- Different services may require different per-request energy models.
- Carbon-intensity APIs can introduce uncertainty through estimation error, regional coverage differences, and refresh lag.
- For controlled experiments, Rilot's CO2e metrics are most useful for comparing policy behavior under a fixed model and signal source.
