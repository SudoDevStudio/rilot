# Comparative Evaluation Summary

- Generated at: `2026-02-25T03:16:37Z`
- Route: `/`
- Requests per region: `150`
- User region input mode: `header-synthetic`
- Baseline for savings: `baseline_no_carbon_balanced`

| scenario | err % | avg latency ms | p95 latency ms | p95 delta ms | reroutes (cross-region) | east->west | west->east | cpu % sample | cpu delta % | mean exposure g/kWh | exposure saved % | co2e saved % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline_no_carbon_balanced | 0.67% | 37.86 | 52.02 | +0.00 | 0 | 0 | 0 | 0.00 | +0.00 | 359.46 | +0.00% | +0.00% |
  - dominant zone: `us-west`; zone split: `{'us-west': 150.0, 'us-east': 150.0}`
| baseline_no_carbon_latency_first | 1.00% | 37.49 | 52.15 | +0.13 | 0 | 0 | 0 | 0.00 | +0.00 | 358.10 | +0.38% | +1.49% |
  - dominant zone: `us-west`; zone split: `{'us-west': 150.0, 'us-east': 150.0}`
| baseline_no_carbon_strict_local | 1.00% | 38.08 | 52.40 | +0.38 | 0 | 0 | 0 | 0.00 | +0.00 | 356.76 | +0.75% | -0.09% |
  - dominant zone: `us-east`; zone split: `{'us-east': 150.0, 'us-west': 150.0}`
| latency_first | 1.33% | 37.45 | 51.87 | -0.15 | 0 | 0 | 0 | 0.00 | +0.00 | 355.45 | +1.11% | +1.93% |
  - dominant zone: `us-west`; zone split: `{'us-west': 150.0, 'us-east': 150.0}`
| carbon_first | 1.33% | 32.44 | 50.01 | -2.01 | 98 | 0 | 98 | 0.00 | +0.00 | 395.39 | -9.99% | +4.38% |
  - dominant zone: `us-east`; zone split: `{'us-west': 52.0, 'us-east': 248.0}`
| balanced | 1.33% | 29.02 | 35.12 | -16.90 | 140 | 0 | 140 | 0.00 | +0.00 | 412.99 | -14.89% | +8.17% |
  - dominant zone: `us-east`; zone split: `{'us-west': 7.0, 'us-east': 293.0}`

## Cross-Region Expectation Check
- Fixture greener region: `us-east`
- Expected cross-region direction (carbon-aware modes): `us-west->us-east`
- `latency_first` observed east->west: `0`, west->east: `0`
- `carbon_first` observed east->west: `0`, west->east: `98`
- `balanced` observed east->west: `0`, west->east: `140`
