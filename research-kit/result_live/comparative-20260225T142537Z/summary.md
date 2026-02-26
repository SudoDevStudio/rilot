# Comparative Evaluation Summary

- Generated at: `2026-02-25T14:26:05Z`
- Route: `/heavy?burn_ms=40`
- Metrics route filter: `/`
- Config file: `config.live.json`
- Compose file: `docker-compose.live.yml`
- Results dir: `result_live`
- Requests per region: `5`
- Backend services: `zone-01,zone-02,zone-03,zone-04,zone-05,zone-06,zone-07,zone-08,zone-09,zone-10`
- User region input mode: `header-synthetic`
- Carbon variance profile: `default`
- Carbon provider override: `none`
- Failure scenario enabled: `False`
- Baseline for savings: `baseline_no_carbon_balanced`

| scenario | err % | avg latency ms | p95 latency ms | p95 delta ms | reroutes (cross-region) | east->west | west->east | cpu % sample | cpu delta % | mem MB sample | mem delta MB | mean exposure g/kWh | exposure saved % | co2e saved % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline_no_carbon_balanced | 10.00% | 71.14 | 82.75 | +0.00 | 0 | 0 | 0 | 2.99 | +0.00 | 7.23 | +0.00 | 435.00 | +0.00% | +0.00% |
  - dominant zone: `zone-01`; zone split: `{'zone-01': 5.0, 'zone-05': 5.0}`
| baseline_no_carbon_latency_first | 0.00% | 72.53 | 86.04 | +3.29 | 0 | 0 | 0 | 2.87 | -0.12 | 6.95 | -0.29 | 435.00 | +0.00% | -1.66% |
  - dominant zone: `zone-01`; zone split: `{'zone-01': 5.0, 'zone-05': 5.0}`
| baseline_no_carbon_strict_local | 0.00% | 71.65 | 86.81 | +4.06 | 0 | 0 | 0 | 2.83 | -0.16 | 6.14 | -1.09 | 435.00 | +0.00% | -0.85% |
  - dominant zone: `zone-01`; zone split: `{'zone-01': 5.0, 'zone-05': 5.0}`
| latency_first | 0.00% | 74.31 | 85.04 | +2.29 | 0 | 0 | 0 | 2.78 | -0.21 | 6.72 | -0.51 | 373.00 | +14.25% | +9.99% |
  - dominant zone: `zone-05`; zone split: `{'zone-10': 1.0, 'zone-06': 1.0, 'zone-02': 1.0, 'zone-01': 1.0, 'zone-03': 1.0, 'zone-07': 1.0, 'zone-05': 2.0, 'zone-09': 2.0}`
| carbon_first | 0.00% | 77.21 | 88.25 | +5.50 | 0 | 0 | 0 | 2.75 | -0.24 | 8.04 | +0.80 | 339.00 | +22.07% | +14.84% |
  - dominant zone: `zone-10`; zone split: `{'zone-10': 2.0, 'zone-07': 1.0, 'zone-08': 1.0, 'zone-06': 2.0, 'zone-09': 2.0, 'zone-05': 1.0, 'zone-02': 1.0}`
| balanced | 10.00% | 76.64 | 84.75 | +2.00 | 0 | 0 | 0 | 2.58 | -0.41 | 6.54 | -0.70 | 366.00 | +15.86% | +8.73% |
  - dominant zone: `zone-09`; zone split: `{'zone-07': 1.0, 'zone-09': 2.0, 'zone-02': 1.0, 'zone-05': 2.0, 'zone-10': 1.0, 'zone-06': 2.0, 'zone-01': 1.0}`

## Cross-Region Expectation Check
- Fixture greener region: `us-east`
- Expected cross-region direction (carbon-aware modes): `us-west->us-east`
- `latency_first` observed east->west: `0`, west->east: `0`
- `carbon_first` observed east->west: `0`, west->east: `0`
- `balanced` observed east->west: `0`, west->east: `0`
