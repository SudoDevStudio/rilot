# Comparative Evaluation Summary

- Generated at: `2026-02-25T04:40:58Z`
- Route: `/`
- Requests per region: `150`
- User region input mode: `header-synthetic`
- Carbon variance profile: `high-variance`
- Failure scenario enabled: `True`
- Baseline for savings: `baseline_no_carbon_balanced`

| scenario | err % | avg latency ms | p95 latency ms | p95 delta ms | reroutes (cross-region) | east->west | west->east | cpu % sample | cpu delta % | mem MB sample | mem delta MB | mean exposure g/kWh | exposure saved % | co2e saved % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline_no_carbon_balanced | 2.00% | 39.52 | 53.57 | +0.00 | 0 | 0 | 0 | 0.00 | +0.00 | 2.77 | +0.00 | 484.38 | +0.00% | +0.00% |
  - dominant zone: `us-east`; zone split: `{'us-east': 150.0, 'us-west': 150.0}`
| baseline_no_carbon_latency_first | 2.00% | 39.43 | 53.71 | +0.15 | 0 | 0 | 0 | 0.00 | +0.00 | 2.78 | +0.01 | 484.83 | -0.09% | +0.31% |
  - dominant zone: `us-east`; zone split: `{'us-east': 150.0, 'us-west': 150.0}`
| baseline_no_carbon_strict_local | 0.33% | 39.14 | 54.20 | +0.63 | 0 | 0 | 0 | 0.00 | +0.00 | 2.81 | +0.04 | 485.20 | -0.17% | +2.65% |
  - dominant zone: `us-west`; zone split: `{'us-west': 150.0, 'us-east': 150.0}`
| latency_first | 2.00% | 31.98 | 40.28 | -13.29 | 136 | 0 | 136 | 0.00 | +0.00 | 2.77 | -0.00 | 817.94 | -68.86% | -58.03% |
  - dominant zone: `us-east`; zone split: `{'us-east': 290.0, 'us-west': 10.0}`
| carbon_first | 0.67% | 30.75 | 37.37 | -16.20 | 139 | 0 | 139 | 0.00 | +0.00 | 2.77 | +0.00 | 818.22 | -68.92% | -52.26% |
  - dominant zone: `us-east`; zone split: `{'us-west': 10.0, 'us-east': 290.0}`
| balanced | 2.33% | 32.51 | 49.24 | -4.32 | 113 | 0 | 113 | 0.00 | +0.00 | 3.27 | +0.50 | 766.11 | -58.16% | -46.37% |
  - dominant zone: `us-east`; zone split: `{'us-east': 268.0, 'us-west': 32.0}`
| carbon_first_provider_timeout | 1.00% | 39.11 | 53.94 | +0.38 | 0 | 0 | 0 | 0.00 | +0.00 | 3.04 | +0.27 | 450.00 | +7.10% | +8.65% |
  - dominant zone: `us-west`; zone split: `{'us-west': 150.0, 'us-east': 150.0}`

## Cross-Region Expectation Check
- Fixture greener region: `us-east`
- Expected cross-region direction (carbon-aware modes): `us-west->us-east`
- `latency_first` observed east->west: `0`, west->east: `136`
- `carbon_first` observed east->west: `0`, west->east: `139`
- `balanced` observed east->west: `0`, west->east: `113`
