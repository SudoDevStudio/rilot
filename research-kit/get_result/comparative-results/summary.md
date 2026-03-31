# Comparative Evaluation Summary

- Generated at: `2026-03-30T22:52:04Z`
- Route: `/heavy?burn_ms=40`
- Metrics route filter: `/`
- Config file: `config.live.dynamic.json`
- Compose file: `docker-compose.live.yml`
- Results dir: `get_result`
- Total requests target (all regions): `3000`
- Requests per region: `1500`
- Backend services: `zone-01,zone-02,zone-03,zone-04,zone-05,zone-06,zone-07,zone-08,zone-09,zone-10`
- User region input mode: `header-synthetic`
- Carbon variance profile: `default`
- Carbon provider override: `electricitymap`
- Failure scenario enabled: `True`
- Baseline for savings: `baseline_no_carbon_balanced`

| scenario | err % | avg latency ms | p95 latency ms | p95 delta ms | reroutes (cross-region) | east->west | west->east | expected cross->green % | cpu % sample | cpu delta % | mem MB sample | mem delta MB | mean exposure g/kWh | exposure saved % | co2e saved % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| carbon_first | 0.87% | 107.58 | 134.35 | +48.36 | 1488 | 1488 | 0 | 99.20% | 0.63 | -0.28 | 9.33 | +0.45 | 225.02 | +35.24% | +23.16% |
  - dominant zone: `zone-06`; zone split: `{'zone-10': 1, 'zone-06': 2973}`
| balanced | 2.00% | 78.32 | 93.93 | +7.94 | 0 | 0 | 0 | 0.00% | 0.75 | -0.16 | 8.71 | -0.17 | 236.36 | +31.98% | +26.47% |
  - dominant zone: `zone-06`; zone split: `{'zone-10': 1423, 'zone-02': 33, 'zone-01': 7, 'zone-06': 1477}`
| latency_first | 1.10% | 74.56 | 89.77 | +3.79 | 0 | 0 | 0 | 0.00% | 0.79 | -0.12 | 9.20 | +0.32 | 347.46 | +0.00% | -2.91% |
  - dominant zone: `zone-05`; zone split: `{'zone-01': 1474, 'zone-05': 1493}`
| carbon_first_provider_timeout | 2.40% | 92.91 | 123.38 | +37.40 | 1462 | 0 | 1462 | 0.00% | 0.90 | -0.01 | 7.93 | -0.95 | 280.00 | +19.42% | +22.52% |
  - dominant zone: `zone-10`; zone split: `{'zone-10': 2928}`
| explicit_cross_region_to_green | 0.80% | 109.00 | 140.66 | +54.68 | 1487 | 1487 | 0 | 99.13% | 0.62 | -0.29 | 9.01 | +0.13 | 225.02 | +35.24% | +22.45% |
  - dominant zone: `zone-06`; zone split: `{'zone-10': 1, 'zone-06': 2975}`
| baseline_no_carbon_strict_local | 1.60% | 72.79 | 86.58 | +0.60 | 0 | 0 | 0 | 0.00% | 0.76 | -0.15 | 7.56 | -1.32 | 347.48 | -0.00% | -0.48% |
  - dominant zone: `zone-05`; zone split: `{'zone-01': 1467, 'zone-05': 1485}`
| baseline_no_carbon_latency_first | 1.70% | 74.06 | 86.96 | +0.98 | 0 | 0 | 0 | 0.00% | 0.87 | -0.04 | 8.98 | +0.10 | 347.46 | +0.00% | -2.11% |
  - dominant zone: `zone-05`; zone split: `{'zone-01': 1465, 'zone-05': 1484}`
| baseline_no_carbon_balanced | 1.80% | 72.57 | 85.98 | +0.00 | 0 | 0 | 0 | 0.00% | 0.91 | +0.00 | 8.88 | +0.00 | 347.47 | +0.00% | +0.00% |
  - dominant zone: `zone-05`; zone split: `{'zone-01': 1465, 'zone-05': 1481}`

## Cross-Region Expectation Check
- Source greener region: `us-west`
- Source type: `csv`
- Expected cross-region direction (carbon-aware modes): `us-east->us-west`
- `carbon_first` observed east->west: `1488`, west->east: `0`, expected cross->green rate: `99.20%` (1488/1500)
- `balanced` observed east->west: `0`, west->east: `0`, expected cross->green rate: `0.00%` (0/1500)
- `latency_first` observed east->west: `0`, west->east: `0`, expected cross->green rate: `0.00%` (0/1500)
- `explicit_cross_region_to_green` observed east->west: `1487`, west->east: `0`, expected cross->green rate: `99.13%` (1487/1500)
