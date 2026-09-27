//! Carbon cache policy, as pure functions.
//!
//! Hosts do I/O; this crate decides what that I/O should be:
//!
//! ```text
//! read stores ─▶ plan()  ─▶ { serve, fetch, refresh }
//!                              │
//!                     provider fetch (host)
//!                              │
//!                          merge() ─▶ { signals, store_writes, stale_served }
//! ```
//!
//! Native Rilot calls these directly; the Cloudflare Worker calls them through
//! WebAssembly, so both apply identical freshness rules.

use rilot_core::{CarbonSignal, Timestamp};
use serde::{Deserialize, Serialize};

pub const DEFAULT_MAX_AGE_SECONDS: u64 = 300;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct CarbonPolicy {
    #[serde(default = "default_max_age")]
    pub max_age_seconds: u64,
    /// Age at which a cached signal is served but refreshed in the background.
    /// `0` disables cache reads entirely (live reload).
    #[serde(default = "default_refresh")]
    pub refresh_seconds: u64,
}

fn default_max_age() -> u64 {
    DEFAULT_MAX_AGE_SECONDS
}

fn default_refresh() -> u64 {
    60
}

impl Default for CarbonPolicy {
    fn default() -> Self {
        CarbonPolicy {
            max_age_seconds: DEFAULT_MAX_AGE_SECONDS,
            refresh_seconds: default_refresh(),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct PlanInput {
    #[serde(default)]
    pub policy: CarbonPolicy,
    pub now: Timestamp,
    pub regions: Vec<String>,
    /// Cached signals in store order (fastest store first); the first entry
    /// for a region wins.
    #[serde(default)]
    pub cached: Vec<CarbonSignal>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PlanOutput {
    /// Usable straight away.
    pub serve: Vec<CarbonSignal>,
    /// Ask the provider for these.
    pub fetch: Vec<String>,
    /// Served from cache, but stale enough to refresh in the background.
    pub refresh: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MergeInput {
    #[serde(default)]
    pub policy: CarbonPolicy,
    pub now: Timestamp,
    /// The regions originally requested, in order.
    pub regions: Vec<String>,
    /// What `plan` said was already usable.
    #[serde(default)]
    pub serve: Vec<CarbonSignal>,
    /// What the provider returned (may be partial, may contain junk).
    #[serde(default)]
    pub fetched: Vec<CarbonSignal>,
    /// Cached values, including ones too old to serve; used only if the
    /// provider could not answer.
    #[serde(default)]
    pub cached: Vec<CarbonSignal>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct MergeOutput {
    /// Final signals, in requested order.
    pub signals: Vec<CarbonSignal>,
    /// Freshly fetched signals worth writing back to every store.
    pub store_writes: Vec<CarbonSignal>,
    /// Regions served from a value older than `max_age_seconds` because the
    /// provider failed. `rilot-core` still treats these as unavailable.
    pub stale_served: Vec<String>,
}

fn is_valid(signal: &CarbonSignal) -> bool {
    !signal.region.trim().is_empty()
        && signal.carbon_g_per_kwh.is_finite()
        && signal.carbon_g_per_kwh >= 0.0
}

fn unique_regions(regions: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::with_capacity(regions.len());
    for region in regions {
        if !region.trim().is_empty() && !out.contains(region) {
            out.push(region.clone());
        }
    }
    out
}

/// First valid entry per region, in the order the host supplied them.
fn index_first<'a>(signals: &'a [CarbonSignal], region: &str) -> Option<&'a CarbonSignal> {
    signals.iter().find(|s| s.region == region && is_valid(s))
}

/// Decides what can be served from cache and what the provider must supply.
pub fn plan(input: &PlanInput) -> PlanOutput {
    let regions = unique_regions(&input.regions);
    let cache_usable = input.policy.refresh_seconds > 0;
    let mut serve = Vec::new();
    let mut fetch = Vec::new();
    let mut refresh = Vec::new();

    for region in regions {
        let cached = if cache_usable {
            index_first(&input.cached, &region)
        } else {
            None
        };
        match cached {
            Some(signal) => {
                let age = input.now.seconds_since(signal.observed_at).max(0) as u64;
                if age <= input.policy.refresh_seconds {
                    serve.push(signal.clone());
                } else if age <= input.policy.max_age_seconds {
                    serve.push(signal.clone());
                    refresh.push(region);
                } else {
                    fetch.push(region);
                }
            }
            None => fetch.push(region),
        }
    }

    PlanOutput {
        serve,
        fetch,
        refresh,
    }
}

/// Combines cached and freshly fetched signals into the final answer.
pub fn merge(input: &MergeInput) -> MergeOutput {
    let regions = unique_regions(&input.regions);
    let mut signals = Vec::new();
    let mut store_writes = Vec::new();
    let mut stale_served = Vec::new();

    for region in regions {
        if let Some(signal) = index_first(&input.serve, &region) {
            signals.push(signal.clone());
            continue;
        }
        if let Some(signal) = index_first(&input.fetched, &region) {
            signals.push(signal.clone());
            store_writes.push(signal.clone());
            continue;
        }
        // The provider could not answer: fall back to whatever is still held.
        if let Some(signal) = index_first(&input.cached, &region) {
            let age = input.now.seconds_since(signal.observed_at).max(0) as u64;
            if age > input.policy.max_age_seconds {
                stale_served.push(region.clone());
            }
            signals.push(signal.clone());
        }
        // Otherwise the region is omitted: never invent a value.
    }

    MergeOutput {
        signals,
        store_writes,
        stale_served,
    }
}

/// JSON wrappers used by the Wasm interface. Errors are returned, never panicked.
pub mod json {
    use super::{merge, plan, MergeInput, PlanInput};
    use serde::Serialize;
    use serde_json::json;

    fn ok<T: Serialize>(output: &T) -> String {
        match serde_json::to_value(output) {
            Ok(value) => json!({ "ok": true, "output": value }).to_string(),
            Err(error) => err(format!("failed to serialize output: {error}")),
        }
    }

    fn err(message: impl Into<String>) -> String {
        json!({ "ok": false, "error": message.into() }).to_string()
    }

    pub fn plan_json(input: &str) -> String {
        match serde_json::from_str::<PlanInput>(input) {
            Ok(parsed) => ok(&plan(&parsed)),
            Err(error) => err(format!("invalid carbon plan input: {error}")),
        }
    }

    pub fn merge_json(input: &str) -> String {
        match serde_json::from_str::<MergeInput>(input) {
            Ok(parsed) => ok(&merge(&parsed)),
            Err(error) => err(format!("invalid carbon merge input: {error}")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rilot_core::SignalSource;

    const NOW: i64 = 1_789_920_000;

    fn signal(region: &str, value: f64, age: i64) -> CarbonSignal {
        CarbonSignal {
            region: region.to_string(),
            carbon_g_per_kwh: value,
            observed_at: Timestamp::from_unix_seconds(NOW - age),
            forecast_g_per_kwh: None,
            source: Some(SignalSource::LocalCache),
        }
    }

    fn regions(values: &[&str]) -> Vec<String> {
        values.iter().map(|s| s.to_string()).collect()
    }

    fn plan_input(policy: CarbonPolicy, request: &[&str], cached: Vec<CarbonSignal>) -> PlanInput {
        PlanInput {
            policy,
            now: Timestamp::from_unix_seconds(NOW),
            regions: regions(request),
            cached,
        }
    }

    #[test]
    fn fresh_entries_are_served_without_a_fetch() {
        let out = plan(&plan_input(
            CarbonPolicy::default(),
            &["us-east-1"],
            vec![signal("us-east-1", 400.0, 30)],
        ));
        assert_eq!(out.serve.len(), 1);
        assert!(out.fetch.is_empty());
        assert!(out.refresh.is_empty());
    }

    #[test]
    fn stale_entries_are_served_and_refreshed() {
        let out = plan(&plan_input(
            CarbonPolicy::default(),
            &["us-east-1"],
            vec![signal("us-east-1", 400.0, 120)],
        ));
        assert_eq!(out.serve.len(), 1);
        assert_eq!(out.refresh, regions(&["us-east-1"]));
        assert!(out.fetch.is_empty());
    }

    #[test]
    fn expired_entries_must_be_fetched() {
        let out = plan(&plan_input(
            CarbonPolicy::default(),
            &["us-east-1"],
            vec![signal("us-east-1", 400.0, 900)],
        ));
        assert!(out.serve.is_empty());
        assert_eq!(out.fetch, regions(&["us-east-1"]));
    }

    #[test]
    fn refresh_zero_bypasses_the_cache() {
        let policy = CarbonPolicy {
            max_age_seconds: 300,
            refresh_seconds: 0,
        };
        let out = plan(&plan_input(
            policy,
            &["us-east-1"],
            vec![signal("us-east-1", 400.0, 5)],
        ));
        assert_eq!(out.fetch, regions(&["us-east-1"]));
        assert!(out.serve.is_empty());
    }

    #[test]
    fn the_first_store_wins_and_duplicates_collapse() {
        let out = plan(&plan_input(
            CarbonPolicy::default(),
            &["us-east-1", "us-east-1"],
            vec![
                signal("us-east-1", 111.0, 10),
                signal("us-east-1", 999.0, 10),
            ],
        ));
        assert_eq!(out.serve.len(), 1);
        assert_eq!(out.serve[0].carbon_g_per_kwh, 111.0);
    }

    #[test]
    fn merge_prefers_served_then_fetched_and_records_writes() {
        let out = merge(&MergeInput {
            policy: CarbonPolicy::default(),
            now: Timestamp::from_unix_seconds(NOW),
            regions: regions(&["us-east-1", "us-west-2"]),
            serve: vec![signal("us-east-1", 400.0, 10)],
            fetched: vec![signal("us-west-2", 90.0, 0)],
            cached: Vec::new(),
        });
        assert_eq!(out.signals.len(), 2);
        assert_eq!(out.store_writes.len(), 1);
        assert_eq!(out.store_writes[0].region, "us-west-2");
        assert!(out.stale_served.is_empty());
    }

    #[test]
    fn merge_falls_back_to_stale_and_flags_it() {
        let out = merge(&MergeInput {
            policy: CarbonPolicy::default(),
            now: Timestamp::from_unix_seconds(NOW),
            regions: regions(&["us-east-1"]),
            serve: Vec::new(),
            fetched: Vec::new(),
            cached: vec![signal("us-east-1", 900.0, 900)],
        });
        assert_eq!(out.signals[0].carbon_g_per_kwh, 900.0);
        assert_eq!(out.stale_served, regions(&["us-east-1"]));
        assert!(out.store_writes.is_empty());
    }

    #[test]
    fn merge_drops_invalid_and_unrequested_signals() {
        let out = merge(&MergeInput {
            policy: CarbonPolicy::default(),
            now: Timestamp::from_unix_seconds(NOW),
            regions: regions(&["us-east-1"]),
            serve: Vec::new(),
            fetched: vec![signal("us-east-1", -5.0, 0), signal("ap-south-1", 100.0, 0)],
            cached: Vec::new(),
        });
        assert!(out.signals.is_empty());
        assert!(out.store_writes.is_empty());
    }
}
