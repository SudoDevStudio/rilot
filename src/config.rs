use serde::Deserialize;
use std::collections::HashMap;

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

#[derive(Debug, Deserialize, Clone)]
pub struct PolicyConstraints {
    #[serde(default = "default_max_candidates")]
    pub max_candidates: usize,
    #[serde(default)]
    pub zone_allowlist: Vec<String>,
    #[serde(default)]
    pub max_added_latency_ms: Option<f64>,
    #[serde(default)]
    pub p95_latency_budget_ms: Option<f64>,
    #[serde(default)]
    pub max_error_rate: Option<f64>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct RoutePolicy {
    #[serde(default = "default_false")]
    pub carbon_cursor_enabled: bool,
    #[serde(default = "default_route_class")]
    pub route_class: String,
    #[serde(default = "default_priority_mode")]
    pub priority_mode: String,
    #[serde(default)]
    pub constraints: PolicyConstraints,
    #[serde(default)]
    pub weights: PolicyWeights,
    #[serde(default = "default_false")]
    pub forecasting_enabled: bool,
    #[serde(default = "default_false")]
    pub time_shift_enabled: bool,
    #[serde(default = "default_forecast_minutes")]
    pub forecast_window_minutes: u32,
    #[serde(default = "default_forecast_threshold")]
    pub forecast_min_improvement_ratio: f64,
    #[serde(default = "default_defer_seconds")]
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
pub struct CarbonProviderConfig {
    #[serde(default = "default_carbon_provider")]
    pub provider: String,
    #[serde(default = "default_cache_ttl_minutes")]
    pub cache_ttl_minutes: u64,
    #[serde(default = "default_default_carbon_intensity")]
    pub default_carbon_intensity: f64,
    #[serde(default = "default_carbon_safe_threshold_g_per_kwh")]
    pub carbon_safe_threshold_g_per_kwh: f64,
    #[serde(default)]
    pub zone_current: HashMap<String, f64>,
    #[serde(default)]
    pub zone_forecast_next: HashMap<String, f64>,
    #[serde(default = "default_provider_timeout_ms")]
    pub provider_timeout_ms: u64,
    #[serde(default = "default_electricitymap_base_url")]
    pub electricitymap_base_url: String,
    #[serde(default)]
    pub electricitymap_api_key: Option<String>,
    #[serde(default = "default_electricitymap_api_token_header")]
    pub electricitymap_api_token_header: String,
    #[serde(default)]
    pub electricitymap_zone_map: HashMap<String, String>,
    #[serde(default)]
    pub electricitymap_disable_estimations: bool,
    #[serde(default)]
    pub electricitymap_local_fixture: Option<String>,
    #[serde(default = "default_false")]
    pub electricitymap_local_live_reload: bool,
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

#[derive(Debug, Deserialize, Clone)]
pub struct ProxyConfig {
    pub app_name: String, // for next version handling directly via name istead url
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
pub struct Config {
    pub proxies: Vec<ProxyConfig>,
    #[serde(default)]
    pub carbon: CarbonProviderConfig,
    #[serde(default)]
    pub metrics: MetricsConfig,
}

fn default_rule_type() -> String {
    "contain".to_string()
}

use std::fs;

pub fn load_config(path: &str) -> Config {
    let data = fs::read_to_string(path).expect("Failed to read config.json");
    serde_json::from_str(&data).expect("Failed to parse config.json")
}


fn default_rewrite_mode() -> String {
    "none".to_string()
}

impl Default for PolicyWeights {
    fn default() -> Self {
        Self {
            w_carbon: default_w_carbon(),
            w_latency: default_w_latency(),
            w_errors: default_w_errors(),
            w_cost: 0.0,
        }
    }
}

impl Default for PolicyConstraints {
    fn default() -> Self {
        Self {
            max_candidates: default_max_candidates(),
            zone_allowlist: Vec::new(),
            max_added_latency_ms: None,
            p95_latency_budget_ms: None,
            max_error_rate: None,
        }
    }
}

impl Default for RoutePolicy {
    fn default() -> Self {
        Self {
            carbon_cursor_enabled: default_false(),
            route_class: default_route_class(),
            priority_mode: default_priority_mode(),
            constraints: PolicyConstraints::default(),
            weights: PolicyWeights::default(),
            forecasting_enabled: default_false(),
            time_shift_enabled: default_false(),
            forecast_window_minutes: default_forecast_minutes(),
            forecast_min_improvement_ratio: default_forecast_threshold(),
            max_defer_seconds: default_defer_seconds(),
            fail_safe_lowest_latency: default_true(),
            hysteresis_delta: default_hysteresis_delta(),
            min_switch_interval_secs: default_min_switch_interval_secs(),
            plugin_enabled: default_true(),
            plugin_timeout_ms: default_plugin_timeout_ms(),
        }
    }
}

impl Default for CarbonProviderConfig {
    fn default() -> Self {
        Self {
            provider: default_carbon_provider(),
            cache_ttl_minutes: default_cache_ttl_minutes(),
            default_carbon_intensity: default_default_carbon_intensity(),
            carbon_safe_threshold_g_per_kwh: default_carbon_safe_threshold_g_per_kwh(),
            zone_current: HashMap::new(),
            zone_forecast_next: HashMap::new(),
            provider_timeout_ms: default_provider_timeout_ms(),
            electricitymap_base_url: default_electricitymap_base_url(),
            electricitymap_api_key: None,
            electricitymap_api_token_header: default_electricitymap_api_token_header(),
            electricitymap_zone_map: HashMap::new(),
            electricitymap_disable_estimations: false,
            electricitymap_local_fixture: None,
            electricitymap_local_live_reload: default_false(),
        }
    }
}

impl Default for MetricsConfig {
    fn default() -> Self {
        Self {
            enabled: default_true(),
            path: default_metrics_path(),
            decision_log_sample_rate: default_decision_log_sample_rate(),
            rollup_interval_secs: default_rollup_interval_secs(),
        }
    }
}

fn default_false() -> bool {
    false
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

fn default_defer_seconds() -> u64 {
    0
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

fn default_cache_ttl_minutes() -> u64 {
    1
}

fn default_default_carbon_intensity() -> f64 {
    450.0
}

fn default_carbon_safe_threshold_g_per_kwh() -> f64 {
    300.0
}

fn default_metrics_path() -> String {
    "/metrics".to_string()
}

fn default_plugin_timeout_ms() -> u64 {
    25
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

fn default_max_candidates() -> usize {
    8
}

fn default_electricitymap_base_url() -> String {
    "https://api.electricitymap.org".to_string()
}

fn default_electricitymap_api_token_header() -> String {
    "auth-token".to_string()
}
