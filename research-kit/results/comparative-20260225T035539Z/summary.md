# Comparative Evaluation Summary

- Generated at: `2026-02-25T03:57:26Z`
- Route: `/`
- Requests per region: `150`
- User region input mode: `header-synthetic`
- Carbon variance profile: `default`
- Failure scenario enabled: `True`
- Baseline for savings: `baseline_no_carbon_balanced`

| scenario | err % | avg latency ms | p95 latency ms | p95 delta ms | reroutes (cross-region) | east->west | west->east | cpu % sample | cpu delta % | mem MB sample | mem delta MB | mean exposure g/kWh | exposure saved % | co2e saved % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline_no_carbon_balanced | 0.67% | 38.74 | 53.06 | +0.00 | 0 | 0 | 0 | 0.00 | +0.00 | 2.79 | +0.00 | 338.57 | +0.00% | +0.00% |
  - dominant zone: `us-east`; zone split: `{'us-east': 150.0, 'us-west': 150.0}`
| baseline_no_carbon_latency_first | 2.67% | 38.05 | 52.70 | -0.36 | 0 | 0 | 0 | 0.00 | +0.00 | 3.03 | +0.24 | 339.20 | -0.18% | +2.12% |
  - dominant zone: `us-west`; zone split: `{'us-west': 150.0, 'us-east': 150.0}`
| baseline_no_carbon_strict_local | 1.67% | 38.66 | 52.19 | -0.87 | 0 | 0 | 0 | 0.00 | +0.00 | 2.79 | +0.01 | 339.89 | -0.39% | -0.43% |
  - dominant zone: `us-east`; zone split: `{'us-east': 150.0, 'us-west': 150.0}`
| latency_first | 0.67% | 32.01 | 46.93 | -6.13 | 117 | 0 | 117 | 0.00 | +0.00 | 2.82 | +0.04 | 387.82 | -14.55% | +4.50% |
  - dominant zone: `us-east`; zone split: `{'us-east': 267.0, 'us-west': 33.0}`
| carbon_first | 1.00% | 38.59 | 52.92 | -0.14 | 0 | 0 | 0 | 0.00 | +0.00 | 2.79 | +0.00 | 341.36 | -0.82% | -0.33% |
  - dominant zone: `us-west`; zone split: `{'us-west': 150.0, 'us-east': 150.0}`
| balanced | 1.33% | 38.33 | 52.52 | -0.54 | 0 | 0 | 0 | 0.00 | +0.00 | 2.76 | -0.03 | 147.49 | +56.44% | +45.82% |
  - dominant zone: `us-west`; zone split: `{'us-west': 150.0, 'default': 145.0, 'us-east': 5.0}`
| carbon_first_provider_timeout | 0.67% | 38.54 | 52.67 | -0.39 | 0 | 0 | 0 | 0.00 | +0.00 | 2.85 | +0.07 | 362.90 | -7.19% | -6.34% |
  - dominant zone: `us-west`; zone split: `{'us-west': 150.0, 'us-east': 150.0}`

## Cross-Region Expectation Check
- Fixture greener region: `us-east`
- Expected cross-region direction (carbon-aware modes): `us-west->us-east`
- `latency_first` observed east->west: `0`, west->east: `117`
- `carbon_first` observed east->west: `0`, west->east: `0`
- `balanced` observed east->west: `0`, west->east: `0`
