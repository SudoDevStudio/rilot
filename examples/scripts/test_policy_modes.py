#!/usr/bin/env python3
import argparse
import json
import os
import sys
import urllib.error
import urllib.request


SCENARIOS = [
    ("balanced", "/search?q=phone"),
    ("latency-first", "/content/home"),
    ("carbon-first", "/batch/reindex"),
]
REGIONS = ["us-east", "us-west"]


def fetch(base_url: str, path: str, region: str, timeout: float) -> dict:
    url = f"{base_url.rstrip('/')}{path}"
    req = urllib.request.Request(url, headers={"x-user-region": region})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = resp.read().decode("utf-8")
        payload = json.loads(body)
        headers = {k.lower(): v for k, v in resp.headers.items()}
        return {
            "status": resp.status,
            "path": path,
            "request_region": region,
            "backend_zone": payload.get("zone", "-"),
            "backend_region": payload.get("region", "-"),
            "selected_zone": headers.get("x-rilot-selected-zone", "-"),
            "decision_reason": headers.get("x-rilot-decision-reason", "-"),
        }


def display_reason(policy_mode: str, decision_reason: str) -> str:
    if not decision_reason or decision_reason == "-":
        return f"policy={policy_mode}"
    return f"policy={policy_mode}, decision={decision_reason}"


def print_table(rows: list[dict]) -> None:
    headers = [
        ("mode", "mode"),
        ("request_region", "request_region"),
        ("path", "path"),
        ("status", "status"),
        ("selected_zone", "selected"),
        ("backend_zone", "backend_zone"),
        ("backend_region", "backend_region"),
        ("decision_summary", "reason"),
    ]
    widths = {}
    for key, title in headers:
        widths[key] = len(title)
    for row in rows:
        for key, _title in headers:
            widths[key] = max(widths[key], len(str(row.get(key, ""))))

    header_line = "  ".join(title.ljust(widths[key]) for key, title in headers)
    divider = "  ".join("-" * widths[key] for key, _title in headers)
    print(header_line)
    print(divider)
    for row in rows:
        print("  ".join(str(row.get(key, "")).ljust(widths[key]) for key, _title in headers))


def print_curl_examples(base_url: str, regions: list[str]) -> None:
    print("\nEquivalent curl commands")
    for region in regions:
        print(f"- request_region={region}")
        for mode, path in SCENARIOS:
            print(f"  {mode}: curl -i -H 'x-user-region: {region}' {base_url.rstrip('/')}{path}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Call the current example policy routes and show which zone answered. "
            "This does not change runtime behavior; it just tests the existing "
            "balanced, latency-first, and carbon-first routes."
        )
    )
    parser.add_argument(
        "--base-url",
        default=os.environ.get("RILOT_TEST_BASE_URL", "http://127.0.0.1:18080"),
        help="Rilot base URL. Default: %(default)s",
    )
    parser.add_argument(
        "--region",
        default="both",
        choices=["us-east", "us-west", "both"],
        help="Value to send in the x-user-region header. Use 'both' to test east and west in one run. Default: %(default)s",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=5.0,
        help="Per-request timeout in seconds. Default: %(default)s",
    )
    parser.add_argument(
        "--show-curl",
        action="store_true",
        help="Also print the equivalent curl commands.",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    rows = []
    regions = REGIONS if args.region == "both" else [args.region]

    print(
        f"Testing {args.base_url.rstrip('/')} with x-user-region="
        f"{', '.join(regions)}\n"
    )

    for region in regions:
        for mode, path in SCENARIOS:
            try:
                result = fetch(args.base_url, path, region, args.timeout)
                result["mode"] = mode
                result["decision_summary"] = display_reason(mode, result["decision_reason"])
                rows.append(result)
            except urllib.error.HTTPError as exc:
                body = exc.read().decode("utf-8", errors="replace").strip()
                rows.append(
                    {
                        "mode": mode,
                        "request_region": region,
                        "path": path,
                        "status": exc.code,
                        "selected_zone": "-",
                        "backend_zone": "-",
                        "backend_region": "-",
                        "decision_summary": display_reason(
                            mode, body[:80] if body else "http error"
                        ),
                    }
                )
            except Exception as exc:
                rows.append(
                    {
                        "mode": mode,
                        "request_region": region,
                        "path": path,
                        "status": "error",
                        "selected_zone": "-",
                        "backend_zone": "-",
                        "backend_region": "-",
                        "decision_summary": display_reason(mode, str(exc)),
                    }
                )

    print_table(rows)

    print("\nHow to read this")
    print("- request_region: the value sent in the x-user-region request header.")
    print("- selected: Rilot-selected zone header, shown only when research headers are enabled.")
    print("- backend_zone/backend_region: the actual upstream app that answered.")
    print("- reason: shows both the configured policy and the final decision reason.")
    print("- Default run checks both us-east and us-west. Use --region to limit it.")

    if args.show_curl:
        print_curl_examples(args.base_url, regions)

    return 0


if __name__ == "__main__":
    sys.exit(main())
