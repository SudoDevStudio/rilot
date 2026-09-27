//! Native configuration loading.
//!
//! Two formats are accepted:
//!
//! * The simple Rilot config (`backends`, `policy`, `radius_km`, `fallback`,
//!   `routing_rules`, plus the adapter-owned `carbon` and `metrics` sections).
//! * The legacy `proxies` format, translated into the same `rilot_core`
//!   routing config so both run through the one core decision engine.

use rilot_core::{
    AdvancedSettings, Backend, Fallback, Policy, RouteClass, RoutingConfig, RoutingRule, Weights,
};
use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::fs;

// ---------------------------------------------------------------------------
// Adapter-owned sections (shared by both formats)
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize, Clone)]
pub struct CarbonProviderConfig {
    #[serde(default = "default_carbon_provider")]
    pub provider: String,
    /// Signals older than this are not used for routing.
    #[serde(default = "default_max_age_seconds")]
    pub max_age_seconds: u64,
    /// How often cached signals are refreshed in the background. Defaults to
    /// `min(60, max_age_seconds)`. Legacy configs call this `cache_ttl_seconds`.
    #[serde(default, alias = "cache_ttl_seconds")]
    pub refresh_seconds: Option<u64>,
    #[serde(default = "default_provider_timeout_ms")]
    pub provider_timeout_ms: u64,
    /// JSON provider source: a file path or an http(s) URL returning
    /// `{"signals": [{"region", "carbon_g_per_kwh", "observed_at"}]}`.
    #[serde(default)]
    pub json_source: Option<String>,
    /// Mock provider values keyed by region (legacy: by zone name).
    #[serde(default)]
    pub zone_current: HashMap<String, f64>,
    #[serde(default)]
    pub zone_forecast_next: HashMap<String, f64>,
    /// Value used when a mock/seeded region has no explicit entry.
    #[serde(default)]
    pub default_carbon_intensity: Option<f64>,
    #[serde(default = "default_carbon_safe_threshold_g_per_kwh")]
    pub carbon_safe_threshold_g_per_kwh: f64,
    #[serde(default = "default_electricitymap_base_url")]
    pub electricitymap_base_url: String,
    /// Prefer the `RILOT_ELECTRICITYMAP_API_KEY` environment variable.
    #[serde(default)]
    pub electricitymap_api_key: Option<String>,
    #[serde(default = "default_electricitymap_api_token_header")]
    pub electricitymap_api_token_header: String,
    /// Optional override of the provider's built-in region → zone mapping.
    #[serde(default)]
    pub electricitymap_zone_map: HashMap<String, String>,
    #[serde(default)]
    pub electricitymap_disable_estimations: bool,
    #[serde(default)]
    pub electricitymap_local_fixture: Option<String>,
    #[serde(default)]
    pub electricitymap_local_live_reload: bool,
}

impl CarbonProviderConfig {
    pub fn refresh_interval_seconds(&self) -> u64 {
        if self.provider == "electricitymap-local" && self.electricitymap_local_live_reload {
            return 0;
        }
        self.refresh_seconds
            .unwrap_or_else(|| self.max_age_seconds.min(60))
    }
}

#[derive(Debug, Deserialize, Clone)]
pub struct MetricsConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default = "default_metrics_path")]
    pub path: String,
    #[serde(default = "default_decision_log_sample_rate")]
    pub decision_log_sample_rate: f64,
    #[serde(default = "default_rollup_interval_secs")]
    pub rollup_interval_secs: u64,
}

/// Native-only behaviour attached to a routing rule (plugins, rewrites, labels).
#[derive(Debug, Clone, Default)]
pub struct RouteExtras {
    /// Label for metrics, logs, and hysteresis state.
    pub label: String,
    pub override_file: Option<String>,
    pub plugin_enabled: bool,
    pub plugin_timeout_ms: u64,
    /// Strip this prefix from the forwarded path (legacy `rewrite: "strip"`).
    pub strip_prefix: Option<String>,
}

/// Fully loaded native config.
#[derive(Debug, Clone)]
pub struct Config {
    pub routing: RoutingConfig,
    pub carbon: CarbonProviderConfig,
    pub metrics: MetricsConfig,
    /// Extras by routing rule index.
    pub rule_extras: Vec<RouteExtras>,
    /// Extras for requests that match no rule.
    pub root_extras: RouteExtras,
    /// Legacy configs reject requests that match no rule (404).
    pub require_rule_match: bool,
}

impl Config {
    pub fn extras_for(&self, rule_index: Option<usize>) -> &RouteExtras {
        rule_index
            .and_then(|i| self.rule_extras.get(i))
            .unwrap_or(&self.root_extras)
    }

    pub fn override_files(&self) -> Vec<String> {
        self.rule_extras
            .iter()
            .chain(std::iter::once(&self.root_extras))
            .filter_map(|e| e.override_file.clone())
            .collect()
    }
}

pub fn load_config(path: &str) -> Config {
    let data = fs::read_to_string(path).expect("Failed to read config.json");
    parse_config(&data).unwrap_or_else(|err| panic!("Invalid config.json: {}", err))
}

pub fn parse_config(json: &str) -> Result<Config, String> {
    let value: serde_json::Value =
        serde_json::from_str(json).map_err(|e| format!("parse error: {e}"))?;
    let config = if value.get("proxies").is_some() {
        let legacy: LegacyConfig =
            serde_json::from_value(value).map_err(|e| format!("parse error: {e}"))?;
        translate_legacy(legacy)?
    } else {
        parse_simple(value)?
    };
    config
        .routing
        .validate()
        .map_err(|errors| errors.join("; "))?;
    for b in &config.routing.backends {
        if b.url.as_deref().is_none_or(|u| u.trim().is_empty()) {
            return Err(format!("backend {:?} must have a url", b.id));
        }
    }
    Ok(config)
}

#[derive(Deserialize)]
struct SimpleSections {
    #[serde(default)]
    carbon: Option<CarbonProviderConfig>,
    #[serde(default)]
    metrics: Option<MetricsConfig>,
}

fn parse_simple(value: serde_json::Value) -> Result<Config, String> {
    let routing: RoutingConfig =
        serde_json::from_value(value.clone()).map_err(|e| format!("parse error: {e}"))?;
    let sections: SimpleSections =
        serde_json::from_value(value).map_err(|e| format!("parse error: {e}"))?;
    let rule_extras = routing
        .routing_rules
        .iter()
        .map(|r| RouteExtras {
            label: r.path.clone(),
            ..RouteExtras::default()
        })
        .collect();
    Ok(Config {
        routing,
        carbon: sections.carbon.unwrap_or_default(),
        metrics: sections.metrics.unwrap_or_default(),
        rule_extras,
        root_extras: RouteExtras {
            label: "*".to_string(),
            ..RouteExtras::default()
        },
        require_rule_match: false,
    })
}

// ---------------------------------------------------------------------------
// Legacy `proxies` format
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize, Clone)]
pub struct ProxyRule {
    pub path: String,
    #[serde(rename = "type", default = "default_rule_type")]
    pub r#type: String,
}

#[derive(Debug, Deserialize, Clone)]
pub struct ZoneConfig {
    pub name: String,
    pub app_uri: String,
    #[serde(default)]
    pub region: Option<String>,
    #[serde(default)]
    pub base_rtt_ms: Option<f64>,
    #[serde(default)]
    pub cost_weight: Option<f64>,
    #[serde(default)]
    pub max_in_flight: Option<usize>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct PolicyWeights {
    #[serde(default = "default_w_carbon")]
    pub w_carbon: f64,
    #[serde(default = "default_w_latency")]
    pub w_latency: f64,
    #[serde(default = "default_w_errors")]
    pub w_errors: f64,
    #[serde(default)]
    pub w_cost: f64,
}

#[derive(Debug, Deserialize, Clone, Default)]
pub struct PolicyConstraints {
    #[serde(default)]
    pub max_candidates: Option<usize>,
    #[serde(default)]
    pub zone_allowlist: Vec<String>,
    #[serde(default)]
    pub max_added_latency_ms: Option<f64>,
    #[serde(default)]
    pub p95_latency_budget_ms: Option<f64>,
    #[serde(default)]
    pub max_error_rate: Option<f64>,
    #[serde(default)]
    pub max_request_share_percent: Option<f64>,
    #[serde(default)]
    pub cross_region_rtt_penalty_ms: Option<f64>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct RoutePolicy {
    #[serde(default)]
    pub carbon_cursor_enabled: bool,
    #[serde(default = "default_route_class")]
    pub route_class: String,
    #[serde(default = "default_priority_mode")]
    pub priority_mode: String,
    #[serde(default)]
    pub constraints: PolicyConstraints,
    #[serde(default)]
    pub weights: Option<PolicyWeights>,
    #[serde(default)]
    pub forecasting_enabled: bool,
    #[serde(default)]
    pub time_shift_enabled: bool,
    #[serde(default = "default_forecast_minutes")]
    pub forecast_window_minutes: u32,
    #[serde(default = "default_forecast_threshold")]
    pub forecast_min_improvement_ratio: f64,
    #[serde(default)]
    pub max_defer_seconds: u64,
    #[serde(default = "default_true")]
    pub fail_safe_lowest_latency: bool,
    #[serde(default = "default_hysteresis_delta")]
    pub hysteresis_delta: f64,
    #[serde(default = "default_min_switch_interval_secs")]
    pub min_switch_interval_secs: u64,
    #[serde(default = "default_true")]
    pub plugin_enabled: bool,
    #[serde(default = "default_plugin_timeout_ms")]
    pub plugin_timeout_ms: u64,
}

#[derive(Debug, Deserialize, Clone)]
pub struct ProxyConfig {
    pub app_name: String,
    pub app_uri: String,
    #[serde(default)]
    pub zones: Vec<ZoneConfig>,
    #[serde(default)]
    pub override_file: Option<String>,
    pub rule: ProxyRule,
    #[serde(default = "default_rewrite_mode")]
    pub rewrite: String,
    #[serde(default)]
    pub policy: RoutePolicy,
}

#[derive(Debug, Deserialize)]
struct LegacyConfig {
    proxies: Vec<ProxyConfig>,
    #[serde(default)]
    carbon: Option<CarbonProviderConfig>,
    #[serde(default)]
    metrics: Option<MetricsConfig>,
}

const LEGACY_DEFAULT_CARBON_INTENSITY: f64 = 450.0;

fn validate_legacy(proxies: &[ProxyConfig]) -> Result<(), String> {
    let mut seen_paths = HashSet::new();
    let mut duplicates = Vec::new();
    for proxy in proxies {
        if !seen_paths.insert(proxy.rule.path.clone()) {
            duplicates.push(proxy.rule.path.clone());
        }
    }
    if duplicates.is_empty() {
        return Ok(());
    }
    duplicates.sort();
    duplicates.dedup();
    Err(format!(
        "duplicate proxy rule.path entries are not allowed: {}",
        duplicates.join(", ")
    ))
}

fn legacy_zones(proxy: &ProxyConfig) -> Vec<Backend> {
    if proxy.zones.is_empty() {
        return vec![Backend {
            id: proxy.app_name.clone(),
            region: proxy.app_name.clone(),
            url: Some(proxy.app_uri.clone()),
            location: None,
            carbon_region: None,
            rtt_ms: Some(20.0),
            cost: None,
            max_in_flight: None,
        }];
    }
    proxy
        .zones
        .iter()
        .map(|z| {
            let region = z.region.clone().unwrap_or_else(|| z.name.clone());
            Backend {
                id: z.name.clone(),
                // Legacy carbon values are keyed by zone name, not region.
                carbon_region: (z.name != region).then(|| z.name.clone()),
                region,
                url: Some(z.app_uri.clone()),
                location: None,
                rtt_ms: Some(z.base_rtt_ms.unwrap_or(35.0)),
                cost: z.cost_weight,
                max_in_flight: z.max_in_flight.map(|v| v as u64),
            }
        })
        .collect()
}

fn legacy_policy(p: &RoutePolicy) -> (Policy, Option<Weights>) {
    let weights = p.weights.as_ref().map(|w| Weights {
        carbon: w.w_carbon,
        latency: w.w_latency,
        reliability: w.w_errors,
        cost: w.w_cost,
    });
    match p.priority_mode.as_str() {
        "carbon-first" => (Policy::Carbon, weights),
        // Legacy latency-first still blended carbon in; keep those weights.
        "latency-first" => (
            Policy::Balanced,
            weights.or(Some(Weights {
                carbon: 0.15,
                latency: 0.65,
                reliability: 0.20,
                cost: 0.0,
            })),
        ),
        _ => (Policy::Balanced, weights),
    }
}

fn legacy_allowlist(proxy: &ProxyConfig, zones: &[Backend]) -> Vec<String> {
    let allow = &proxy.policy.constraints.zone_allowlist;
    let tags_of = |id: &str| {
        proxy
            .zones
            .iter()
            .find(|z| z.name == id)
            .map(|z| z.tags.clone())
            .unwrap_or_default()
    };
    let filtered: Vec<String> = zones
        .iter()
        .filter(|b| {
            allow.is_empty()
                || allow.contains(&b.id)
                || allow.contains(&b.region)
                || allow
                    .iter()
                    .filter_map(|e| e.strip_prefix("tag:"))
                    .any(|tag| tags_of(&b.id).iter().any(|t| t == tag))
        })
        .map(|b| b.id.clone())
        .collect();
    if filtered.is_empty() {
        zones.iter().map(|b| b.id.clone()).collect()
    } else {
        filtered
    }
}

fn translate_legacy(legacy: LegacyConfig) -> Result<Config, String> {
    validate_legacy(&legacy.proxies)?;
    let mut backends: Vec<Backend> = Vec::new();
    let mut rules = Vec::new();
    let mut rule_extras = Vec::new();

    for proxy in &legacy.proxies {
        let zones = legacy_zones(proxy);
        for zone in &zones {
            match backends.iter().find(|b| b.id == zone.id) {
                Some(existing) if existing.url != zone.url || existing.region != zone.region => {
                    return Err(format!(
                        "zone {:?} is defined with different app_uri/region in multiple proxies",
                        zone.id
                    ));
                }
                Some(_) => {}
                None => backends.push(zone.clone()),
            }
        }

        let p = &proxy.policy;
        let c = &p.constraints;
        let (policy, weights) = legacy_policy(p);
        let route_class = match p.route_class.as_str() {
            "strict-local" => RouteClass::StrictLocal,
            "background" => RouteClass::Background,
            _ => RouteClass::Flexible,
        };
        let path = match proxy.rule.r#type.as_str() {
            "exact" => proxy.rule.path.clone(),
            _ => format!("{}*", proxy.rule.path),
        };
        rules.push(RoutingRule {
            path,
            policy: Some(policy),
            radius_km: None,
            fallback: Some(if p.fail_safe_lowest_latency {
                Fallback::LowestLatency
            } else {
                Fallback::None
            }),
            backends: Some(legacy_allowlist(proxy, &zones)),
            advanced: AdvancedSettings {
                weights,
                carbon_aware: Some(p.carbon_cursor_enabled),
                route_class: Some(route_class),
                max_latency_delta_ms: c.max_added_latency_ms,
                hard_max_latency_ms: c.p95_latency_budget_ms,
                min_carbon_benefit_g_per_kwh: None,
                max_error_rate: c.max_error_rate,
                max_request_share_percent: c.max_request_share_percent,
                max_candidates: Some(c.max_candidates.unwrap_or(8)),
                hysteresis_delta: Some(p.hysteresis_delta),
                min_switch_interval_secs: Some(p.min_switch_interval_secs),
                forecasting: Some(p.forecasting_enabled && p.forecast_window_minutes > 0),
                time_shift: Some(p.time_shift_enabled),
                forecast_min_improvement_ratio: Some(p.forecast_min_improvement_ratio),
                max_defer_seconds: Some(p.max_defer_seconds),
                cross_region_rtt_penalty_ms: c.cross_region_rtt_penalty_ms,
            },
        });
        rule_extras.push(RouteExtras {
            label: proxy.rule.path.clone(),
            override_file: proxy.override_file.clone(),
            plugin_enabled: p.plugin_enabled,
            plugin_timeout_ms: p.plugin_timeout_ms,
            strip_prefix: (proxy.rewrite == "strip").then(|| proxy.rule.path.clone()),
        });
    }

    let mut carbon = legacy.carbon.unwrap_or_default();
    // Legacy providers always produced a value; keep that for research reproducibility.
    carbon
        .default_carbon_intensity
        .get_or_insert(LEGACY_DEFAULT_CARBON_INTENSITY);

    Ok(Config {
        routing: RoutingConfig {
            backends,
            policy: None,
            radius_km: None,
            fallback: None,
            routing_rules: rules,
            advanced: AdvancedSettings::default(),
        },
        carbon,
        metrics: legacy.metrics.unwrap_or_default(),
        rule_extras,
        root_extras: RouteExtras::default(),
        require_rule_match: true,
    })
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

impl Default for RoutePolicy {
    fn default() -> Self {
        serde_json::from_str("{}").expect("defaults")
    }
}

impl Default for CarbonProviderConfig {
    fn default() -> Self {
        serde_json::from_str("{}").expect("defaults")
    }
}

impl Default for MetricsConfig {
    fn default() -> Self {
        serde_json::from_str("{}").expect("defaults")
    }
}

fn default_rule_type() -> String {
    "prefix".to_string()
}
fn default_rewrite_mode() -> String {
    "none".to_string()
}
fn default_true() -> bool {
    true
}
fn default_route_class() -> String {
    "flexible".to_string()
}
fn default_priority_mode() -> String {
    "balanced".to_string()
}
fn default_w_carbon() -> f64 {
    0.5
}
fn default_w_latency() -> f64 {
    0.35
}
fn default_w_errors() -> f64 {
    0.15
}
fn default_forecast_minutes() -> u32 {
    30
}
fn default_forecast_threshold() -> f64 {
    0.10
}
fn default_hysteresis_delta() -> f64 {
    0.05
}
fn default_min_switch_interval_secs() -> u64 {
    30
}
fn default_carbon_provider() -> String {
    "mock".to_string()
}
fn default_max_age_seconds() -> u64 {
    rilot_core::decision::DEFAULT_CARBON_MAX_AGE_SECONDS
}
fn default_carbon_safe_threshold_g_per_kwh() -> f64 {
    300.0
}
fn default_metrics_path() -> String {
    "/metrics".to_string()
}
fn default_plugin_timeout_ms() -> u64 {
    800
}
fn default_provider_timeout_ms() -> u64 {
    75
}
fn default_decision_log_sample_rate() -> f64 {
    0.01
}
fn default_rollup_interval_secs() -> u64 {
    60
}
fn default_electricitymap_base_url() -> String {
    "https://api.electricitymap.org".to_string()
}
fn default_electricitymap_api_token_header() -> String {
    "auth-token".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn simple_config_parses_with_adapter_sections() {
        let cfg = parse_config(
            r#"{
              "carbon": {"provider": "electricitymap", "max_age_seconds": 300},
              "backends": [
                {"id": "east", "region": "us-east-1", "url": "https://east.example.com"},
                {"id": "west", "region": "us-west-2", "url": "https://west.example.com"}
              ],
              "policy": "balanced",
              "radius_km": 2000,
              "fallback": "nearest",
              "routing_rules": [{"path": "/checkout/*", "policy": "latency", "radius_km": 800}]
            }"#,
        )
        .expect("config");
        assert!(!cfg.require_rule_match);
        assert_eq!(cfg.carbon.provider, "electricitymap");
        assert_eq!(cfg.carbon.default_carbon_intensity, None);
        assert_eq!(cfg.rule_extras[0].label, "/checkout/*");
        let eff = cfg.routing.resolve("/checkout/pay");
        assert_eq!(eff.policy, Policy::Latency);
        assert_eq!(eff.radius_km, Some(800.0));
    }

    #[test]
    fn simple_config_requires_backend_urls() {
        let err = parse_config(r#"{"backends": [{"id": "a", "region": "us-east-1"}]}"#)
            .expect_err("missing url");
        assert!(err.contains("must have a url"));
    }

    #[test]
    fn legacy_rejects_duplicate_rule_paths() {
        let err = parse_config(
            r#"{"proxies": [
                {"app_name": "a", "app_uri": "http://a", "rule": {"path": "/api", "type": "prefix"}},
                {"app_name": "b", "app_uri": "http://b", "rule": {"path": "/api", "type": "exact"}}
            ]}"#,
        )
        .expect_err("duplicate rule.path should fail");
        assert!(err.contains("/api"));
    }

    #[test]
    fn legacy_translation_preserves_zones_rules_and_policy() {
        let cfg = parse_config(
            r#"{"proxies": [
                {"app_name": "svc", "app_uri": "http://svc", "rewrite": "strip",
                 "rule": {"path": "/batch", "type": "prefix"},
                 "zones": [
                   {"name": "bg-east", "region": "us-east", "app_uri": "http://e", "base_rtt_ms": 60, "tags": ["background"]},
                   {"name": "us-west", "region": "us-west", "app_uri": "http://w", "base_rtt_ms": 80}
                 ],
                 "policy": {"carbon_cursor_enabled": true, "route_class": "background",
                            "priority_mode": "carbon-first", "fail_safe_lowest_latency": true,
                            "constraints": {"zone_allowlist": ["tag:background"]}}}
            ]}"#,
        )
        .expect("legacy config");
        assert!(cfg.require_rule_match);
        assert_eq!(cfg.carbon.default_carbon_intensity, Some(450.0));
        let east = cfg.routing.backend("bg-east").unwrap();
        assert_eq!(east.carbon_key(), "bg-east");
        assert_eq!(east.rtt_ms, Some(60.0));
        assert_eq!(
            cfg.routing.backend("us-west").unwrap().carbon_key(),
            "us-west"
        );

        let eff = cfg.routing.resolve("/batch/job");
        assert_eq!(eff.matched_rule.unwrap().path, "/batch*");
        assert_eq!(eff.policy, Policy::Carbon);
        assert_eq!(eff.fallback, Fallback::LowestLatency);
        assert_eq!(eff.backends, vec!["bg-east"]);
        assert_eq!(eff.advanced.route_class, RouteClass::Background);
        assert_eq!(cfg.rule_extras[0].label, "/batch");
        assert_eq!(cfg.rule_extras[0].strip_prefix.as_deref(), Some("/batch"));
    }

    #[test]
    fn legacy_carbon_cursor_disabled_means_latency_policy() {
        let cfg = parse_config(
            r#"{"proxies": [{"app_name": "a", "app_uri": "http://a",
                "rule": {"path": "/", "type": "prefix"},
                "policy": {"carbon_cursor_enabled": false, "weights": {"w_carbon": 1, "w_latency": 0, "w_errors": 0}}}]}"#,
        )
        .unwrap();
        assert_eq!(cfg.routing.resolve("/x").policy, Policy::Latency);
    }

    #[test]
    fn repository_example_configs_load() {
        for path in [
            "examples/config/config.json",
            "examples/config/legacy-proxies.json",
            "research-kit/config.docker.json",
            "research-kit/config.live.json",
        ] {
            let full = format!("{}/{}", env!("CARGO_MANIFEST_DIR"), path);
            let raw = fs::read_to_string(&full).unwrap_or_else(|e| panic!("{path}: {e}"));
            parse_config(&raw).unwrap_or_else(|e| panic!("{path}: {e}"));
        }
    }
}
