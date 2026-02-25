# Comparative Evaluation Summary

- Generated at: `2026-02-25T05:01:52Z`
- Route: `/`
- Requests per region: `20`
- User region input mode: `header-synthetic`
- Carbon variance profile: `high-variance`
- Failure scenario enabled: `True`
- Baseline for savings: `baseline_no_carbon_balanced`

| scenario | err % | avg latency ms | p95 latency ms | p95 delta ms | reroutes (cross-region) | east->west | west->east | cpu % sample | cpu delta % | mem MB sample | mem delta MB | mean exposure g/kWh | exposure saved % | co2e saved % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline_no_carbon_balanced | 0.00% | 36.79 | 51.32 | +0.00 | 0 | 0 | 0 | 4.86 | +0.00 | 5.92 | +0.00 | 428.08 | +0.00% | +0.00% |
  - dominant zone: `us-west`; zone split: `{'us-west': 20.0, 'us-east': 20.0}`
| baseline_no_carbon_latency_first | 5.00% | 38.88 | 53.50 | +2.17 | 0 | 0 | 0 | 5.47 | +0.62 | 5.24 | -0.68 | 429.65 | -0.37% | -3.55% |
  - dominant zone: `us-west`; zone split: `{'us-west': 20.0, 'us-east': 20.0}`
| baseline_no_carbon_strict_local | 0.00% | 36.91 | 53.59 | +2.27 | 0 | 0 | 0 | 4.88 | +0.02 | 5.66 | -0.27 | 430.67 | -0.60% | -3.69% |
  - dominant zone: `us-east`; zone split: `{'us-east': 20.0, 'us-west': 20.0}`
| latency_first | 0.00% | 38.63 | 52.23 | +0.90 | 0 | 0 | 0 | 5.09 | +0.24 | 5.85 | -0.07 | 431.18 | -0.72% | -3.81% |
  - dominant zone: `us-east`; zone split: `{'us-east': 20.0, 'us-west': 20.0}`
| carbon_first | 0.00% | 28.27 | 33.69 | -17.63 | 20 | 0 | 20 | 6.11 | +1.25 | 5.52 | -0.40 | 115.29 | +73.07% | +82.85% |
  - dominant zone: `us-east`; zone split: `{'us-east': 40.0}`
| balanced | 0.00% | 28.67 | 34.31 | -17.02 | 20 | 0 | 20 | 6.11 | +1.25 | 5.71 | -0.21 | 115.42 | +73.04% | +82.54% |
  - dominant zone: `us-east`; zone split: `{'us-east': 40.0}`
| carbon_first_provider_timeout | 0.00% | 28.86 | 35.50 | -15.83 | 20 | 0 | 20 | 5.81 | +0.96 | 5.46 | -0.46 | 120.00 | +71.97% | +81.61% |
  - dominant zone: `us-east`; zone split: `{'us-east': 40.0}`

## Cross-Region Expectation Check
- Fixture greener region: `us-east`
- Expected cross-region direction (carbon-aware modes): `us-west->us-east`
- `latency_first` observed east->west: `0`, west->east: `0`
- `carbon_first` observed east->west: `0`, west->east: `20`
- `balanced` observed east->west: `0`, west->east: `20`
