# Comparative Evaluation Summary

- Generated at: `2026-02-26T03:08:50Z`
- Route: `/`
- Metrics route filter: `/`
- Config file: `config.docker.json`
- Compose file: `docker-compose.yml`
- Results dir: `results`
- Requests per region: `150`
- Backend services: `us-east,us-west`
- User region input mode: `header-synthetic`
- Carbon variance profile: `default`
- Carbon provider override: `none`
- Failure scenario enabled: `True`
- Baseline for savings: `baseline_no_carbon_balanced`

| scenario | err % | avg latency ms | p95 latency ms | p95 delta ms | reroutes (cross-region) | east->west | west->east | expected cross->green % | cpu % sample | cpu delta % | mem MB sample | mem delta MB | mean exposure g/kWh | exposure saved % | co2e saved % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| carbon_first | 1.67% | 44.11 | 54.43 | +1.49 | 78 | 78 | 0 | 0.00% | 4.39 | -0.44 | 5.32 | -0.57 | 346.50 | +10.92% | -3.24% |
  - dominant zone: `us-west`; zone split: `{'us-west': 229.0, 'us-east': 71.0}`
| balanced | 0.67% | 40.71 | 53.13 | +0.19 | 43 | 43 | 0 | 0.00% | 4.18 | -0.65 | 5.62 | -0.27 | 363.97 | +6.43% | +0.14% |
  - dominant zone: `us-west`; zone split: `{'us-east': 107.0, 'us-west': 193.0}`
| latency_first | 0.67% | 30.23 | 36.11 | -16.83 | 141 | 0 | 141 | 94.00% | 4.84 | +0.01 | 5.72 | -0.17 | 449.50 | -15.56% | +6.00% |
  - dominant zone: `us-east`; zone split: `{'us-east': 292.0, 'us-west': 8.0}`
| carbon_first_provider_timeout | 1.00% | 30.43 | 36.89 | -16.05 | 159 | 11 | 148 | 98.67% | 6.45 | +1.62 | 5.58 | -0.31 | 424.80 | -9.21% | +12.65% |
  - dominant zone: `us-east`; zone split: `{'us-west': 12.0, 'us-east': 288.0}`
| explicit_cross_region_to_green | 2.00% | 37.76 | 51.15 | -1.79 | 0 | 0 | 0 | 0.00% | 4.25 | -0.58 | 5.66 | -0.23 | 385.89 | +0.79% | +2.19% |
  - dominant zone: `us-west`; zone split: `{'us-east': 149.0, 'us-west': 151.0}`
| baseline_no_carbon_strict_local | 1.67% | 38.00 | 51.45 | -1.49 | 0 | 0 | 0 | 0.00% | 4.36 | -0.47 | 5.63 | -0.26 | 387.26 | +0.44% | +1.19% |
  - dominant zone: `us-east`; zone split: `{'us-east': 150.0, 'us-west': 150.0}`
| baseline_no_carbon_latency_first | 1.67% | 38.08 | 51.33 | -1.61 | 0 | 0 | 0 | 0.00% | 4.46 | -0.37 | 5.85 | -0.04 | 388.15 | +0.21% | +0.69% |
  - dominant zone: `us-west`; zone split: `{'us-west': 150.0, 'us-east': 150.0}`
| baseline_no_carbon_balanced | 0.67% | 38.91 | 52.94 | +0.00 | 0 | 0 | 0 | 0.00% | 4.83 | +0.00 | 5.89 | +0.00 | 388.98 | +0.00% | +0.00% |
  - dominant zone: `us-east`; zone split: `{'us-east': 150.0, 'us-west': 150.0}`

## Cross-Region Expectation Check
- Fixture greener region: `us-east`
- Expected cross-region direction (carbon-aware modes): `us-west->us-east`
- `carbon_first` observed east->west: `78`, west->east: `0`, expected cross->green rate: `0.00%` (0/150)
- `balanced` observed east->west: `43`, west->east: `0`, expected cross->green rate: `0.00%` (0/150)
- `latency_first` observed east->west: `0`, west->east: `141`, expected cross->green rate: `94.00%` (141/150)
- `explicit_cross_region_to_green` observed east->west: `0`, west->east: `0`, expected cross->green rate: `0.00%` (0/150)
