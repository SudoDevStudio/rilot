# Comparative Evaluation Summary

- Generated at: `2026-02-25T05:06:56Z`
- Route: `/`
- Requests per region: `5`
- User region input mode: `header-synthetic`
- Carbon variance profile: `default`
- Carbon provider override: `electricitymap-local`
- Failure scenario enabled: `False`
- Baseline for savings: `baseline_no_carbon_balanced`

| scenario | err % | avg latency ms | p95 latency ms | p95 delta ms | reroutes (cross-region) | east->west | west->east | cpu % sample | cpu delta % | mem MB sample | mem delta MB | mean exposure g/kWh | exposure saved % | co2e saved % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline_no_carbon_balanced | 0.00% | 39.40 | 54.97 | +0.00 | 0 | 0 | 0 | 6.87 | +0.00 | 5.47 | +0.00 | 365.00 | +0.00% | +0.00% |
  - dominant zone: `us-west`; zone split: `{'us-west': 5.0, 'us-east': 5.0}`
| baseline_no_carbon_latency_first | 0.00% | 37.50 | 50.17 | -4.80 | 0 | 0 | 0 | 7.21 | +0.34 | 5.15 | -0.32 | 365.00 | +0.00% | +5.71% |
  - dominant zone: `us-east`; zone split: `{'us-east': 5.0, 'us-west': 5.0}`
| baseline_no_carbon_strict_local | 0.00% | 36.85 | 51.42 | -3.55 | 0 | 0 | 0 | 7.52 | +0.65 | 5.28 | -0.19 | 365.00 | +0.00% | +7.64% |
  - dominant zone: `us-east`; zone split: `{'us-east': 5.0, 'us-west': 5.0}`
| latency_first | 10.00% | 35.68 | 53.95 | -1.02 | 0 | 0 | 0 | 7.24 | +0.38 | 5.52 | +0.05 | 193.00 | +47.12% | +41.36% |
  - dominant zone: `us-west`; zone split: `{'us-east': 1.0, 'default': 4.0, 'us-west': 5.0}`
| carbon_first | 0.00% | 39.00 | 55.28 | +0.32 | 0 | 0 | 0 | 9.45 | +2.58 | 5.36 | -0.11 | 365.00 | +0.00% | +2.53% |
  - dominant zone: `us-west`; zone split: `{'us-west': 5.0, 'us-east': 5.0}`
| balanced | 0.00% | 37.29 | 47.29 | -7.68 | 0 | 0 | 0 | 7.42 | +0.55 | 5.89 | +0.42 | 365.00 | +0.00% | +5.70% |
  - dominant zone: `us-east`; zone split: `{'us-east': 5.0, 'us-west': 5.0}`

## Cross-Region Expectation Check
- Fixture greener region: `us-east`
- Expected cross-region direction (carbon-aware modes): `us-west->us-east`
- `latency_first` observed east->west: `0`, west->east: `0`
- `carbon_first` observed east->west: `0`, west->east: `0`
- `balanced` observed east->west: `0`, west->east: `0`
