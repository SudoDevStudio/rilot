# Comparative Evaluation Summary

- Generated at: `2026-02-25T04:52:47Z`
- Route: `/`
- Requests per region: `150`
- User region input mode: `header-synthetic`
- Carbon variance profile: `high-variance`
- Failure scenario enabled: `True`
- Baseline for savings: `baseline_no_carbon_balanced`

| scenario | err % | avg latency ms | p95 latency ms | p95 delta ms | reroutes (cross-region) | east->west | west->east | cpu % sample | cpu delta % | mem MB sample | mem delta MB | mean exposure g/kWh | exposure saved % | co2e saved % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline_no_carbon_balanced | 1.00% | 39.07 | 53.20 | +0.00 | 0 | 0 | 0 | 0.00 | +0.00 | 2.82 | +0.00 | 432.47 | +0.00% | +0.00% |
  - dominant zone: `us-west`; zone split: `{'us-west': 150.0, 'us-east': 150.0}`
| baseline_no_carbon_latency_first | 2.00% | 38.71 | 53.07 | -0.13 | 0 | 0 | 0 | 0.00 | +0.00 | 2.77 | -0.05 | 430.92 | +0.36% | +1.40% |
  - dominant zone: `us-east`; zone split: `{'us-east': 150.0, 'us-west': 150.0}`
| baseline_no_carbon_strict_local | 1.33% | 38.98 | 53.21 | +0.01 | 0 | 0 | 0 | 0.00 | +0.00 | 2.81 | -0.01 | 429.43 | +0.70% | +1.04% |
  - dominant zone: `us-west`; zone split: `{'us-west': 150.0, 'us-east': 150.0}`
| latency_first | 2.33% | 38.75 | 52.62 | -0.58 | 0 | 0 | 0 | 0.00 | +0.00 | 2.78 | -0.04 | 372.83 | +13.79% | +8.87% |
  - dominant zone: `us-west`; zone split: `{'default': 145.0, 'us-east': 5.0, 'us-west': 150.0}`
| carbon_first | 1.00% | 38.25 | 53.13 | -0.07 | 0 | 0 | 0 | 0.00 | +0.00 | 2.78 | -0.03 | 370.49 | +14.33% | +11.31% |
  - dominant zone: `us-west`; zone split: `{'us-west': 150.0, 'default': 148.0, 'us-east': 2.0}`
| balanced | 1.33% | 29.72 | 35.69 | -17.51 | 149 | 0 | 149 | 0.00 | +0.00 | 3.09 | +0.28 | 113.40 | +73.78% | +83.17% |
  - dominant zone: `us-east`; zone split: `{'us-east': 300.0}`
| carbon_first_provider_timeout | 1.00% | 30.28 | 35.91 | -17.29 | 147 | 0 | 147 | 0.00 | +0.00 | 2.84 | +0.03 | 120.00 | +72.25% | +82.09% |
  - dominant zone: `us-east`; zone split: `{'us-east': 300.0}`

## Cross-Region Expectation Check
- Fixture greener region: `us-east`
- Expected cross-region direction (carbon-aware modes): `us-west->us-east`
- `latency_first` observed east->west: `0`, west->east: `0`
- `carbon_first` observed east->west: `0`, west->east: `0`
- `balanced` observed east->west: `0`, west->east: `149`
