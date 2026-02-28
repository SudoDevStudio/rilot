# Comparative Evaluation Summary

- Generated at: `2026-02-27T22:21:33Z`
- Route: `/heavy?burn_ms=40`
- Metrics route filter: `/`
- Config file: `config.live.dynamic.json`
- Compose file: `docker-compose.live.yml`
- Results dir: `result_live`
- Requests per region: `500`
- Backend services: `zone-01,zone-02,zone-03,zone-04,zone-05,zone-06,zone-07,zone-08,zone-09,zone-10`
- User region input mode: `header-synthetic`
- Carbon variance profile: `default`
- Carbon provider override: `electricitymap`
- Failure scenario enabled: `True`
- Baseline for savings: `baseline_no_carbon_balanced`

| scenario | err % | avg latency ms | p95 latency ms | p95 delta ms | reroutes (cross-region) | east->west | west->east | expected cross->green % | cpu % sample | cpu delta % | mem MB sample | mem delta MB | mean exposure g/kWh | exposure saved % | co2e saved % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| carbon_first | 1.60% | 95.43 | 130.93 | +41.37 | 404 | 284 | 115 | 0.00% | 0.57 | +0.01 | 8.15 | +0.64 | 239.41 | +57.76% | +56.14% |
  - dominant zone: `zone-09`; zone split: `{'zone-10': 48, 'zone-06': 156, 'zone-09': 434, 'zone-08': 5, 'zone-02': 225, 'zone-05': 72, 'zone-01': 44}`
| balanced | 1.70% | 85.66 | 127.43 | +37.86 | 233 | 122 | 87 | 0.00% | 0.58 | +0.02 | 10.64 | +3.13 | 379.76 | +32.99% | +33.73% |
  - dominant zone: `zone-06`; zone split: `{'zone-10': 98, 'zone-06': 199, 'zone-09': 195, 'zone-05': 132, 'zone-01': 137, 'zone-02': 147, 'zone-07': 51, 'zone-08': 5, 'zone-03': 19}`
| latency_first | 1.30% | 74.26 | 88.68 | -0.89 | 0 | 0 | 0 | 0.00% | 0.59 | +0.02 | 7.73 | +0.22 | 482.95 | +14.79% | +17.00% |
  - dominant zone: `zone-06`; zone split: `{'zone-10': 185, 'zone-01': 237, 'zone-02': 48, 'zone-07': 22, 'zone-09': 22, 'zone-06': 326, 'zone-05': 147}`
| carbon_first_provider_timeout | 1.70% | 99.68 | 130.05 | +40.49 | 532 | 186 | 148 | 0.00% | 0.66 | +0.09 | 7.66 | +0.16 | 323.27 | +42.96% | +41.59% |
  - dominant zone: `zone-09`; zone split: `{'zone-10': 193, 'zone-07': 150, 'zone-09': 199, 'zone-08': 198, 'zone-02': 12, 'zone-06': 198, 'zone-05': 33}`
| explicit_cross_region_to_green | 1.20% | 93.41 | 130.79 | +41.23 | 354 | 208 | 71 | 0.00% | 0.55 | -0.02 | 8.61 | +1.10 | 263.74 | +53.47% | +51.14% |
  - dominant zone: `zone-09`; zone split: `{'zone-10': 61, 'zone-06': 220, 'zone-09': 317, 'zone-08': 75, 'zone-01': 68, 'zone-02': 152, 'zone-05': 95}`
| baseline_no_carbon_strict_local | 0.60% | 71.96 | 85.63 | -3.93 | 0 | 0 | 0 | 0.00% | 0.51 | -0.05 | 7.55 | +0.04 | 579.45 | -2.24% | +1.66% |
  - dominant zone: `zone-05`; zone split: `{'zone-01': 496, 'zone-05': 498}`
| baseline_no_carbon_latency_first | 1.20% | 72.18 | 85.88 | -3.69 | 0 | 0 | 0 | 0.00% | 0.57 | +0.00 | 7.76 | +0.25 | 575.52 | -1.54% | +2.22% |
  - dominant zone: `zone-05`; zone split: `{'zone-01': 492, 'zone-05': 496}`
| baseline_no_carbon_balanced | 1.50% | 74.78 | 89.56 | +0.00 | 0 | 0 | 0 | 0.00% | 0.57 | +0.00 | 7.51 | +0.00 | 566.77 | +0.00% | +0.00% |
  - dominant zone: `zone-05`; zone split: `{'zone-01': 491, 'zone-05': 494}`
