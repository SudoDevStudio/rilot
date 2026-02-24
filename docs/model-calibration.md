# Model Calibration and CO2e Caveats

## Purpose

Rilot reports estimated energy and carbon metrics to support relative policy comparison experiments.
These values should be interpreted as model outputs, not direct power meter readings.

## Current estimation model

Per request, Rilot computes:

1. `energy_joules_estimated`
2. `co2e_estimated_total`

Default energy estimate in `src/proxy.rs`:

- `energy_joules = 0.6 * latency_ms + 0.0005 * bytes`

Carbon conversion:

- `co2e_g = (energy_joules / 3_600_000) * carbon_intensity_g_per_kwh`

Carbon intensity source:

- Provider signal (`electricitymap`, `electricitymap-local`, or mock values)
- Optional plugin override (`carbon_intensity_g_per_kwh_override`)

Energy override source:

- Optional plugin override (`energy_joules_override`)

## Calibration recommendations

1. Collect measured service energy (RAPL, smart PDU, cloud telemetry, or host meter) under representative load.
2. Fit coefficients against measured joules/request for each service class.
3. Update plugin overrides or core estimation parameters accordingly.
4. Report both:
   - absolute error against measured data
   - relative ranking stability across policies

## Reporting caveats (for papers)

- Results are sensitive to proxy model coefficients.
- Different services may require different per-request energy models.
- Carbon-intensity APIs can include estimation uncertainty and refresh lag.

## Recommended language

Use wording such as:

"Rilot's CO2e metrics are model-based estimates used for controlled comparative evaluation of routing policies. Absolute values should be calibrated against measured power data for production claims."
