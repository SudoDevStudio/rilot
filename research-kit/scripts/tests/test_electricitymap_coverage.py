#!/usr/bin/env python3
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
import sys

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from electricitymap_coverage import (  # noqa: E402
    build_zone_aliases,
    build_zone_map_from_coverage,
    config_zone_order,
    enforce_min_cache_ttl,
    load_available_carbon_intensity_zones,
)


def sample_cfg() -> dict:
    return {
        "proxies": [
            {
                "zones": [
                    {"name": "zone-01", "region": "us-east"},
                    {"name": "zone-02", "region": "us-east"},
                    {"name": "zone-03", "region": "us-central"},
                    {"name": "zone-04", "region": "us-west"},
                ]
            }
        ]
    }


class ElectricityMapCoverageTests(unittest.TestCase):
    def test_load_available_carbon_intensity_zones_filters_rows(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            csv_path = Path(td) / "coverage.csv"
            csv_path.write_text(
                "zone,zone_key,tier,signal,available_from,historical_temporal_granularity,real_time_granularity,forecast_source,horizons,forecast_granularity\n"
                "ISO New England,US-NE-ISNE,A,Carbon Intensity,2020-01-01,hourly,5min,provider,24h,5min\n"
                "ISO New England,US-NE-ISNE,A,Renewable Energy,2020-01-01,hourly,5min,provider,24h,5min\n"
                "CAISO,US-CAL-CISO,A,Carbon Intensity,2020-01-01,hourly,,provider,24h,5min\n",
                encoding="utf-8",
            )
            got = load_available_carbon_intensity_zones(csv_path)
            self.assertEqual(got, {"US-NE-ISNE": "ISO New England"})

    def test_build_zone_map_from_coverage_uses_expected_regions(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            csv_path = Path(td) / "coverage.csv"
            csv_path.write_text(
                "zone,zone_key,tier,signal,available_from,historical_temporal_granularity,real_time_granularity,forecast_source,horizons,forecast_granularity\n"
                "ISO New England,US-NE-ISNE,A,Carbon Intensity,2020-01-01,hourly,5min,provider,24h,5min\n"
                "New York ISO,US-NY-NYIS,A,Carbon Intensity,2020-01-01,hourly,5min,provider,24h,5min\n"
                "Midcontinent ISO,US-MIDW-MISO,A,Carbon Intensity,2020-01-01,hourly,5min,provider,24h,5min\n"
                "CAISO,US-CAL-CISO,A,Carbon Intensity,2020-01-01,hourly,5min,provider,24h,5min\n",
                encoding="utf-8",
            )
            zone_map = build_zone_map_from_coverage(sample_cfg(), csv_path, enabled=True)
            self.assertEqual(zone_map["zone-01"], "US-NE-ISNE")
            self.assertEqual(zone_map["zone-02"], "US-NY-NYIS")
            self.assertEqual(zone_map["zone-03"], "US-MIDW-MISO")
            self.assertEqual(zone_map["zone-04"], "US-CAL-CISO")

    def test_build_zone_aliases_respects_zone_order(self) -> None:
        zone_map = {
            "zone-02": "US-NY-NYIS",
            "zone-01": "US-NE-ISNE",
        }
        order = ["zone-01", "zone-02"]
        aliases = build_zone_aliases(zone_map, order)
        self.assertEqual(aliases, "US-NE-ISNE:zone-01,US-NY-NYIS:zone-02")

    def test_config_zone_order_collects_names_once(self) -> None:
        cfg = {
            "proxies": [
                {"zones": [{"name": "zone-01"}, {"name": "zone-02"}]},
                {"zones": [{"name": "zone-02"}, {"name": "zone-03"}]},
            ]
        }
        self.assertEqual(config_zone_order(cfg), ["zone-01", "zone-02", "zone-03"])

    def test_enforce_min_cache_ttl_applies_floor(self) -> None:
        carbon = {"cache_ttl_seconds": 0}
        ttl = enforce_min_cache_ttl(carbon, 5)
        self.assertEqual(ttl, 5)
        self.assertEqual(carbon["cache_ttl_seconds"], 5)

    def test_enforce_min_cache_ttl_keeps_higher_existing_value(self) -> None:
        carbon = {"cache_ttl_seconds": 10}
        ttl = enforce_min_cache_ttl(carbon, 5)
        self.assertEqual(ttl, 10)
        self.assertEqual(carbon["cache_ttl_seconds"], 10)


if __name__ == "__main__":
    unittest.main()
