# Comparative Evaluation Summary

- Generated at: `2026-02-26T03:44:10Z`
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
| carbon_first | 1.33% | 45.38 | 52.86 | +0.76 | 137 | 137 | 0 | 0.00% | 3.41 | -0.71 | 5.62 | -0.29 | 329.18 | +16.35% | -5.83% |
  - dominant zone: `us-west`; zone split: `{'us-east': 12.0, 'us-west': 288.0}`
| balanced | 1.33% | 29.06 | 34.66 | -17.44 | 149 | 1 | 148 | 98.67% | 4.83 | +0.72 | 5.89 | -0.01 | 28.35 | +92.80% | +94.41% |
  - dominant zone: `default`; zone split: `{'default': 281.0, 'us-west': 2.0, 'us-east': 17.0}`
| latency_first | 1.00% | 30.12 | 35.55 | -16.55 | 143 | 0 | 143 | 95.33% | 4.88 | +0.76 | 5.15 | -0.75 | 461.41 | -17.26% | +4.07% |
  - dominant zone: `us-east`; zone split: `{'us-west': 6.0, 'us-east': 294.0}`
| carbon_first_provider_timeout | 2.33% | 46.10 | 53.61 | +1.51 | 144 | 144 | 0 | 0.00% | 4.13 | +0.01 | 5.31 | -0.59 | 301.30 | +23.43% | +1.26% |
  - dominant zone: `us-west`; zone split: `{'us-west': 297.0, 'us-east': 3.0}`
| explicit_cross_region_to_green | 1.00% | 38.05 | 52.33 | +0.23 | 8 | 8 | 0 | 0.00% | 4.00 | -0.12 | 5.68 | -0.22 | 389.81 | +0.94% | -0.22% |
  - dominant zone: `us-west`; zone split: `{'us-east': 141.0, 'us-west': 159.0}`
| baseline_no_carbon_strict_local | 2.67% | 37.66 | 52.25 | +0.15 | 0 | 0 | 0 | 0.00% | 4.19 | +0.07 | 5.40 | -0.50 | 393.89 | -0.10% | +0.50% |
  - dominant zone: `us-west`; zone split: `{'us-west': 150.0, 'us-east': 150.0}`
| baseline_no_carbon_latency_first | 0.00% | 37.53 | 50.98 | -1.12 | 0 | 0 | 0 | 0.00% | 4.20 | +0.08 | 5.49 | -0.41 | 393.74 | -0.06% | +0.44% |
  - dominant zone: `us-west`; zone split: `{'us-west': 150.0, 'us-east': 150.0}`
| baseline_no_carbon_balanced | 2.00% | 37.75 | 52.10 | +0.00 | 0 | 0 | 0 | 0.00% | 4.12 | +0.00 | 5.90 | +0.00 | 393.51 | +0.00% | +0.00% |
  - dominant zone: `us-east`; zone split: `{'us-east': 150.0, 'us-west': 150.0}`

## Cross-Region Expectation Check
- Fixture greener region: `us-east`
- Expected cross-region direction (carbon-aware modes): `us-west->us-east`
- `carbon_first` observed east->west: `137`, west->east: `0`, expected cross->green rate: `0.00%` (0/150)
- `balanced` observed east->west: `1`, west->east: `148`, expected cross->green rate: `98.67%` (148/150)
- `latency_first` observed east->west: `0`, west->east: `143`, expected cross->green rate: `95.33%` (143/150)
- `explicit_cross_region_to_green` observed east->west: `8`, west->east: `0`, expected cross->green rate: `0.00%` (0/150)
