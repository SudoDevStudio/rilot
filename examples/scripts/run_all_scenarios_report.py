#!/usr/bin/env python3
import json
import os
import re
import signal
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RILOT_BIN = ROOT / "target" / "debug" / "rilot"
CONFIG = ROOT / "examples" / "config" / "config.json"
RUN_ZONES = ROOT / "examples" / "node-apps" / "run-local-zones.sh"
RILOT_PORT = int(os.environ.get("RILOT_SCENARIO_PORT", "18080"))
SCENARIO_LIVE_RELOAD = os.environ.get("RILOT_SCENARIO_LIVE_RELOAD", "false").lower() in ("1", "true", "yes")
BASE = f"http://127.0.0.1:{RILOT_PORT}"

SCENARIOS = [
    ("strict_local_checkout", "us-east", "/checkout/ping", {}),
    ("flex_search_east", "us-east", "/search?q=phone", {}),
    ("flex_search_west", "us-west", "/search?q=laptop", {}),
    ("latency_first_content", "us-west", "/content/home", {}),
    ("background_batch", "us-east", "/batch/reindex", {}),
    ("plugin_energy", "us-east", "/plugin-energy/demo", {}),
    (
        "header_override_disable_carbon",
        "us-east",
        "/search?q=override",
        {"x-rilot-carbon-cursor": "false"},
    ),
    ("default_fallback", "us-west", "/", {}),
]


def wait_http(url: str, attempts: int = 60, sleep_s: float = 0.2) -> bool:
    for _ in range(attempts):
        try:
            with urllib.request.urlopen(url, timeout=2):
                return True
        except Exception:
            time.sleep(sleep_s)
    return False


def get_json(url: str, headers: dict) -> dict:
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=5) as resp:
        return json.loads(resp.read().decode("utf-8"))


def get_text(url: str) -> str:
    with urllib.request.urlopen(url, timeout=5) as resp:
        return resp.read().decode("utf-8")


def resolve_path_from_root(path_str: str) -> Path:
    p = Path(path_str)
    return p if p.is_absolute() else (ROOT / p).resolve()


def force_west_green_window(fixture_path: Path):
    with open(fixture_path, "r", encoding="utf-8") as f:
        doc = json.load(f)
    zones = doc.setdefault("zones", {})
    east = zones.setdefault("us-east", {})
    west = zones.setdefault("us-west", {})
    east["carbonIntensity"] = 700
    east["carbonIntensityForecast"] = 680
    west["carbonIntensity"] = 80
    west["carbonIntensityForecast"] = 70
    with open(fixture_path, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=2)
        f.write("\n")


def parse_metric_sum(metrics_text: str, metric_name: str) -> float:
    total = 0.0
    prefix = f"{metric_name}{{"
    for line in metrics_text.splitlines():
        line = line.strip()
        if not line.startswith(prefix):
            continue
        try:
            total += float(line.rsplit(" ", 1)[1])
        except Exception:
            continue
    return total


def start_proc(cmd, cwd, extra_env=None):
    env = os.environ.copy()
    if extra_env:
        env.update(extra_env)
    return subprocess.Popen(
        cmd,
        cwd=str(cwd),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        env=env,
        preexec_fn=os.setsid,
    )


def stop_proc(proc: subprocess.Popen):
    if proc.poll() is not None:
        return
    os.killpg(proc.pid, signal.SIGTERM)
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        os.killpg(proc.pid, signal.SIGKILL)


def main() -> int:
    if not RUN_ZONES.exists():
        print(f"missing: {RUN_ZONES}")
        return 1

    zones = start_proc([str(RUN_ZONES)], ROOT)
    rilot = None
    temp_config_path = None
    temp_fixture_path = None
    try:
        for p in [5601, 5602, 5603, 5604, 5605, 3012]:
            if not wait_http(f"http://127.0.0.1:{p}/health"):
                print(f"zone app did not start on port {p}")
                return 1

        subprocess.run(["cargo", "build", "--quiet"], cwd=str(ROOT), check=True)
        with open(CONFIG, "r", encoding="utf-8") as f:
            cfg = json.load(f)

        # Deterministic scenario mode:
        # disable hysteresis stickiness so per-scenario route decisions can switch immediately.
        for proxy in cfg.get("proxies", []):
            policy = proxy.get("policy", {})
            policy["min_switch_interval_secs"] = 0
            policy["hysteresis_delta"] = 0.0

        carbon = cfg.get("carbon", {})
        # In local fixture mode, default behavior should follow in-memory TTL cache.
        # For demo runs that need on-the-fly fixture updates, enable:
        # RILOT_SCENARIO_LIVE_RELOAD=true
        if carbon.get("provider") == "electricitymap-local":
            carbon["electricitymap_local_live_reload"] = SCENARIO_LIVE_RELOAD
            fixture = carbon.get("electricitymap_local_fixture")
            if fixture:
                src_fixture = resolve_path_from_root(fixture)
                with open(src_fixture, "r", encoding="utf-8") as f:
                    fixture_doc = json.load(f)
                fixture_tmp = tempfile.NamedTemporaryFile(
                    mode="w",
                    suffix=".json",
                    prefix="rilot-electricitymap-local-",
                    delete=False,
                    encoding="utf-8",
                )
                json.dump(fixture_doc, fixture_tmp, indent=2)
                fixture_tmp.flush()
                fixture_tmp.close()
                temp_fixture_path = fixture_tmp.name
                carbon["electricitymap_local_fixture"] = temp_fixture_path

        tmp = tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", prefix="rilot-scenarios-", delete=False, encoding="utf-8"
        )
        json.dump(cfg, tmp, indent=2)
        tmp.flush()
        tmp.close()
        temp_config_path = tmp.name

        rilot = start_proc(
            [str(RILOT_BIN), temp_config_path],
            ROOT,
            extra_env={"RILOT_PORT": str(RILOT_PORT)},
        )

        if not wait_http(f"{BASE}/metrics"):
            print("rilot did not become ready on /metrics")
            return 1

        print("Scenario responses")
        for name, region, path, extra in SCENARIOS:
            if name == "flex_search_west" and temp_fixture_path and SCENARIO_LIVE_RELOAD:
                force_west_green_window(Path(temp_fixture_path))
            headers = {"x-user-region": region}
            headers.update(extra)
            try:
                payload = get_json(f"{BASE}{path}", headers)
                print(f"- {name}: zone={payload.get('zone')} status=ok")
            except urllib.error.HTTPError as e:
                body = e.read().decode("utf-8", errors="replace")
                print(f"- {name}: http_error={e.code} body={body}")
            except Exception as e:
                print(f"- {name}: error={e}")

        metrics_text = get_text(f"{BASE}/metrics")
        total_requests = parse_metric_sum(metrics_text, "requests_total")
        safe_calls = parse_metric_sum(metrics_text, "carbon_safe_calls_total")
        safe_ratio = (safe_calls / total_requests * 100.0) if total_requests > 0 else 0.0

        print("\nCarbon-safe summary")
        print(f"- total_requests: {int(total_requests)}")
        print(f"- carbon_safe_calls: {int(safe_calls)}")
        print(f"- carbon_safe_ratio_percent: {safe_ratio:.2f}")

        print("\nRelevant metrics")
        for line in metrics_text.splitlines():
            if line.startswith("requests_total{") or line.startswith("carbon_safe_calls_total{") or line.startswith("carbon_safe_call_ratio{"):
                print(line)

        return 0
    finally:
        if rilot is not None:
            stop_proc(rilot)
        stop_proc(zones)
        if temp_config_path:
            try:
                os.remove(temp_config_path)
            except OSError:
                pass
        if temp_fixture_path:
            try:
                os.remove(temp_fixture_path)
            except OSError:
                pass


if __name__ == "__main__":
    sys.exit(main())
