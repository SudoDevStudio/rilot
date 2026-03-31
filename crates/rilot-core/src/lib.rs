use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyWeights {
    pub w_carbon: f64,
    pub w_latency: f64,
    pub w_errors: f64,
    pub w_cost: f64,
}

pub fn balanced_weights() -> PolicyWeights {
    PolicyWeights {
        w_carbon: 0.50,
        w_latency: 0.35,
        w_errors: 0.15,
        w_cost: 0.0,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoutePolicy {
    pub route_class: String,
    pub carbon_cursor_enabled: bool,
    pub forecasting_enabled: bool,
    pub time_shift_enabled: bool,
    pub plugin_enabled: bool,
}

pub fn classify_route(defaults: &RoutePolicy, headers: &HashMap<String, String>) -> RoutePolicy {
    let mut route_class = header_or_none(headers, "x-rilot-class")
        .unwrap_or_else(|| defaults.route_class.clone());
    if route_class.is_empty() {
        route_class = "flexible".to_string();
    }
    let mut result = RoutePolicy {
        route_class,
        carbon_cursor_enabled: bool_override(
            headers,
            "x-rilot-carbon-cursor",
            defaults.carbon_cursor_enabled,
        ),
        forecasting_enabled: bool_override(
            headers,
            "x-rilot-forecasting",
            defaults.forecasting_enabled,
        ),
        time_shift_enabled: bool_override(
            headers,
            "x-rilot-time-shift",
            defaults.time_shift_enabled,
        ),
        plugin_enabled: bool_override(headers, "x-rilot-plugin", defaults.plugin_enabled),
    };

    if result.route_class == "strict-local" {
        result.plugin_enabled = false;
        result.time_shift_enabled = false;
    }

    result
}

pub fn effective_weights(
    priority_mode: &str,
    configured_weights: Option<PolicyWeights>,
) -> PolicyWeights {
    if let Some(weights) = configured_weights {
        return weights;
    }

    match priority_mode {
        "latency-first" => PolicyWeights {
            w_carbon: 0.15,
            w_latency: 0.65,
            w_errors: 0.20,
            w_cost: 0.0,
        },
        "carbon-first" => PolicyWeights {
            w_carbon: 0.70,
            w_latency: 0.20,
            w_errors: 0.10,
            w_cost: 0.0,
        },
        "custom" | "balanced" => balanced_weights(),
        _ => balanced_weights(),
    }
}

fn header_or_none(headers: &HashMap<String, String>, key: &str) -> Option<String> {
    headers.get(key).cloned()
}

fn bool_override(headers: &HashMap<String, String>, key: &str, default_value: bool) -> bool {
    match headers.get(key).map(|v| v.as_str()) {
        Some("1") | Some("true") | Some("on") | Some("yes") => true,
        Some("0") | Some("false") | Some("off") | Some("no") => false,
        _ => default_value,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strict_local_disables_plugin_and_time_shift() {
        let defaults = RoutePolicy {
            route_class: "strict-local".to_string(),
            carbon_cursor_enabled: true,
            forecasting_enabled: true,
            time_shift_enabled: true,
            plugin_enabled: true,
        };
        let out = classify_route(&defaults, &HashMap::new());
        assert!(!out.plugin_enabled);
        assert!(!out.time_shift_enabled);
    }

    #[test]
    fn explicit_weights_override_priority_mode_presets() {
        let weights = PolicyWeights {
            w_carbon: 1.0,
            w_latency: 0.0,
            w_errors: 0.0,
            w_cost: 0.0,
        };

        let out = effective_weights("latency-first", Some(weights.clone()));

        assert_eq!(out.w_carbon, weights.w_carbon);
        assert_eq!(out.w_latency, weights.w_latency);
        assert_eq!(out.w_errors, weights.w_errors);
        assert_eq!(out.w_cost, weights.w_cost);
    }

    #[test]
    fn custom_mode_without_explicit_weights_uses_balanced_defaults() {
        let out = effective_weights("custom", None);

        assert_eq!(out.w_carbon, 0.50);
        assert_eq!(out.w_latency, 0.35);
        assert_eq!(out.w_errors, 0.15);
        assert_eq!(out.w_cost, 0.0);
    }

}
