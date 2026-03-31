#!/usr/bin/env python3
from __future__ import annotations

import csv
from pathlib import Path
from typing import Dict, Iterable, Mapping, Optional

REGION_PREFERRED_ZONE_KEYS = {
    "us-east": [
        "US-NE-ISNE",
        "US-NY-NYIS",
        "US-MIDA-PJM",
        "US-CAR-DUK",
        "US-SE-SOCO",
        "US-FLA-FPL",
        "US-CAR-CPLE",
        "US-CAR-CPLW",
    ],
    "us-central": [
        "US-MIDW-MISO",
        "US-CENT-SWPP",
        "US-TEX-ERCO",
        "US-TEN-TVA",
        "US-CENT-SPA",
        "US-MIDW-AECI",
    ],
    "us-west": [
        "US-CAL-CISO",
        "US-NW-BPAT",
        "US-SW-AZPS",
        "US-NW-PACW",
        "US-CAL-BANC",
        "US-NW-PSEI",
        "US-SW-SRP",
    ],
}

REGION_PREFIX_FALLBACKS = {
    "us-east": ("US-NE-", "US-NY-", "US-MIDA-", "US-CAR-", "US-SE-", "US-FLA-"),
    "us-central": ("US-MIDW-", "US-CENT-", "US-TEX-", "US-TEN-"),
    "us-west": ("US-CAL-", "US-NW-", "US-SW-", "US-AK", "US-HI"),
}

FALSE_VALUES = {"0", "false", "no", "off"}


def config_zone_order(cfg: Mapping) -> list[str]:
    ordered: list[str] = []
    seen: set[str] = set()
    for proxy in cfg.get("proxies", []):
        for zone in proxy.get("zones", []):
            name = str(zone.get("name", "")).strip()
            if name and name not in seen:
                ordered.append(name)
                seen.add(name)
    return ordered


def load_available_carbon_intensity_zones(csv_path: Path) -> Dict[str, str]:
    out: Dict[str, str] = {}
    if not csv_path.exists() or not csv_path.is_file():
        return out
    with csv_path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            signal = str(row.get("signal", "")).strip().lower()
            realtime = str(row.get("real_time_granularity", "")).strip()
            zone_key = str(row.get("zone_key", "")).strip()
            zone_name = str(row.get("zone", "")).strip()
            if signal != "carbon intensity":
                continue
            if not realtime:
                continue
            if not zone_key:
                continue
            if zone_key not in out:
                out[zone_key] = zone_name or zone_key
    return out


def _pick_zone_key(region: str, available_keys: Iterable[str], used: set[str]) -> str:
    available = list(available_keys)
    available_set = set(available)
    reg = (region or "").strip().lower()

    for key in REGION_PREFERRED_ZONE_KEYS.get(reg, []):
        if key in available_set and key not in used:
            return key

    prefixes = REGION_PREFIX_FALLBACKS.get(reg, ())
    if prefixes:
        for key in available:
            if key in used:
                continue
            if any(key.startswith(prefix) for prefix in prefixes):
                return key

    for key in available:
        if key not in used and key.startswith("US-"):
            return key

    for key in available:
        if key not in used:
            return key

    return ""


def derive_zone_map(cfg: Mapping, available_zone_keys: Mapping[str, str]) -> Dict[str, str]:
    out: Dict[str, str] = {}
    available_sorted = sorted(available_zone_keys.keys())
    used: set[str] = set()
    for proxy in cfg.get("proxies", []):
        for zone in proxy.get("zones", []):
            zone_name = str(zone.get("name", "")).strip()
            region = str(zone.get("region", "")).strip().lower()
            if not zone_name:
                continue
            picked = _pick_zone_key(region, available_sorted, used)
            if not picked:
                continue
            out[zone_name] = picked
            used.add(picked)
    return out


def build_zone_map_from_coverage(
    cfg: Mapping,
    coverage_csv_path: Optional[Path],
    enabled: bool = True,
) -> Dict[str, str]:
    if not enabled:
        return {}
    if coverage_csv_path is None:
        return {}
    available = load_available_carbon_intensity_zones(coverage_csv_path)
    if not available:
        return {}
    return derive_zone_map(cfg, available)


def build_zone_aliases(zone_map: Mapping[str, str], zone_order: Optional[Iterable[str]] = None) -> str:
    if not zone_map:
        return ""
    order = list(zone_order) if zone_order else sorted(zone_map.keys())
    pairs = []
    seen = set()
    for internal_name in order:
        external_name = zone_map.get(internal_name)
        if not external_name:
            continue
        pair = f"{external_name}:{internal_name}"
        if pair in seen:
            continue
        seen.add(pair)
        pairs.append(pair)
    return ",".join(pairs)


def parse_bool_flag(raw: str, default: bool = True) -> bool:
    if raw is None:
        return default
    value = raw.strip().lower()
    if not value:
        return default
    return value not in FALSE_VALUES


def enforce_min_cache_ttl(carbon_cfg: dict, min_ttl_seconds: int) -> int:
    try:
        min_ttl = max(0, int(min_ttl_seconds))
    except Exception:
        min_ttl = 0
    try:
        current_ttl = int(carbon_cfg.get("cache_ttl_seconds", 0))
    except Exception:
        current_ttl = 0
    resolved = max(current_ttl, min_ttl)
    carbon_cfg["cache_ttl_seconds"] = resolved
    return resolved
