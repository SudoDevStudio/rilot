//! Native wiring for the shared carbon layer (`crates/rilot-carbon`).
//!
//! This file only maps config to a provider, stores, and a policy. The
//! freshness/refresh/fallback rules live in `rilot_carbon::CarbonService`, and
//! provider zone mapping lives inside each provider.

use crate::config::CarbonProviderConfig;
use anyhow::{bail, Result};
use rilot_carbon::service::{
    CachePolicy, CarbonEvent, CarbonProvider, CarbonService, ProviderContext, SignalsFuture,
};
use rilot_carbon::{
    ElectricityMapsLocalProvider, ElectricityMapsProvider, JsonProvider, MemoryStore,
    StaticProvider, Timestamp,
};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub fn now_timestamp() -> Timestamp {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    Timestamp::from_unix_seconds(secs)
}

/// A provider that answers too late, used to study provider timeouts.
struct SlowProvider {
    inner: StaticProvider,
    delay: Duration,
}

impl CarbonProvider for SlowProvider {
    fn name(&self) -> &str {
        "slow-mock"
    }

    fn fetch<'a>(&'a self, regions: &'a [String], ctx: ProviderContext) -> SignalsFuture<'a> {
        Box::pin(async move {
            tokio::time::sleep(self.delay).await;
            Ok(self.inner.signals_at(regions, ctx.now))
        })
    }
}

fn seeded_provider(cfg: &CarbonProviderConfig, drift: bool) -> StaticProvider {
    let mut values = cfg.zone_current.clone();
    if let Some(default) = cfg.default_carbon_intensity {
        // Legacy configs expect every zone to resolve to something.
        for region in cfg.zone_forecast_next.keys() {
            values.entry(region.clone()).or_insert(default);
        }
    }
    StaticProvider::new(values)
        .with_forecasts(cfg.zone_forecast_next.clone())
        .with_drift(drift)
}

fn build_provider(cfg: &CarbonProviderConfig) -> Result<Option<Arc<dyn CarbonProvider>>> {
    let provider: Arc<dyn CarbonProvider> = match cfg.provider.as_str() {
        "none" => return Ok(None),
        "mock" => Arc::new(seeded_provider(cfg, true)),
        "static" => Arc::new(seeded_provider(cfg, false)),
        "slow-mock" => Arc::new(SlowProvider {
            inner: seeded_provider(cfg, true),
            delay: Duration::from_millis(cfg.provider_timeout_ms + 10),
        }),
        "json" => match &cfg.json_source {
            Some(source) => Arc::new(JsonProvider::new(source.clone())),
            None => bail!("carbon.provider \"json\" requires carbon.json_source"),
        },
        "electricitymap" => {
            let api_key = std::env::var("RILOT_ELECTRICITYMAP_API_KEY")
                .ok()
                .filter(|k| !k.trim().is_empty())
                .or_else(|| cfg.electricitymap_api_key.clone());
            match api_key {
                Some(key) => Arc::new(
                    ElectricityMapsProvider::new(key)
                        .with_base_url(cfg.electricitymap_base_url.clone())
                        .with_token_header(cfg.electricitymap_api_token_header.clone())
                        .with_zone_overrides(cfg.electricitymap_zone_map.clone())
                        .with_disable_estimations(cfg.electricitymap_disable_estimations),
                ),
                // Legacy research configs ship seeds and no key; keep them working.
                None => {
                    log::warn!("electricitymap_api_key_missing=true; using configured seed values");
                    Arc::new(seeded_provider(cfg, false))
                }
            }
        }
        "electricitymap-local" => match &cfg.electricitymap_local_fixture {
            Some(path) => Arc::new(
                ElectricityMapsLocalProvider::new(path.clone())
                    .with_zone_overrides(cfg.electricitymap_zone_map.clone())
                    .with_forecasts(cfg.zone_forecast_next.clone()),
            ),
            None => Arc::new(seeded_provider(cfg, false)),
        },
        other => bail!("unknown carbon provider {other:?}"),
    };
    Ok(Some(provider))
}

/// Builds the carbon service used by the proxy: one provider, an in-process
/// cache, and background refresh on the Tokio runtime.
pub fn build_service(cfg: &CarbonProviderConfig) -> Result<Arc<CarbonService>> {
    Ok(CarbonService::builder()
        .maybe_provider(build_provider(cfg)?)
        .store(Arc::new(MemoryStore::new()))
        .policy(CachePolicy::new(
            cfg.max_age_seconds,
            Some(cfg.refresh_interval_seconds()),
            Some(cfg.provider_timeout_ms),
        ))
        .spawner(Arc::new(|work| {
            match tokio::runtime::Handle::try_current() {
                Ok(handle) => {
                    handle.spawn(work);
                }
                // No runtime (unit tests): the caller awaits instead.
                Err(_) => log::debug!("carbon background work skipped: no Tokio runtime"),
            }
        }))
        .on_event(Arc::new(|event| match event {
            CarbonEvent::ProviderError {
                provider,
                regions,
                error,
            } => {
                log::warn!(
                    "carbon_provider_failed=true provider={provider} regions={} error={error}",
                    regions.join(",")
                )
            }
            CarbonEvent::StaleServed {
                region,
                age_seconds,
            } => {
                log::warn!("carbon_stale_served=true region={region} age_seconds={age_seconds}")
            }
            _ => {}
        }))
        .build())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn cfg(json: &str) -> CarbonProviderConfig {
        serde_json::from_str(json).unwrap()
    }

    fn rt() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
    }

    fn regions(values: &[&str]) -> Vec<String> {
        values.iter().map(|s| s.to_string()).collect()
    }

    fn temp_json(prefix: &str, body: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path =
            std::env::temp_dir().join(format!("{prefix}-{}-{nanos}.json", std::process::id()));
        std::fs::write(&path, body).unwrap();
        path
    }

    #[test]
    fn static_provider_serves_configured_values() {
        let c = cfg(r#"{"provider": "static", "zone_current": {"us-east-1": 200}}"#);
        let service = build_service(&c).unwrap();
        let signals = rt()
            .block_on(service.get_signals(&regions(&["us-east-1", "nowhere"]), now_timestamp()));
        assert_eq!(
            signals.len(),
            1,
            "unknown regions are unavailable, not invented"
        );
        assert_eq!(signals[0].carbon_g_per_kwh, 200.0);
    }

    #[test]
    fn slow_provider_times_out_to_unavailable() {
        let c = cfg(
            r#"{"provider": "slow-mock", "provider_timeout_ms": 5, "zone_current": {"us-east-1": 400}}"#,
        );
        let service = build_service(&c).unwrap();
        let signals = rt().block_on(service.get_signals(&regions(&["us-east-1"]), now_timestamp()));
        assert!(signals.is_empty());
    }

    #[test]
    fn electricitymap_without_a_key_falls_back_to_seeds() {
        if std::env::var("RILOT_ELECTRICITYMAP_API_KEY").is_ok() {
            return;
        }
        let c = cfg(r#"{"provider": "electricitymap", "zone_current": {"us-east-1": 321}}"#);
        let service = build_service(&c).unwrap();
        let signals = rt().block_on(service.get_signals(&regions(&["us-east-1"]), now_timestamp()));
        assert_eq!(signals[0].carbon_g_per_kwh, 321.0);
    }

    #[test]
    fn electricitymap_local_reads_the_fixture_through_the_zone_map() {
        let path = temp_json(
            "rilot-local-zone-map",
            r#"{"zones": {"EM-US-EAST": {"carbonIntensity": 123, "carbonIntensityForecast": 111}}}"#,
        );
        let mut c = cfg(r#"{"provider": "electricitymap-local"}"#);
        c.electricitymap_local_fixture = Some(path.to_string_lossy().into());
        c.electricitymap_zone_map
            .insert("zone-a".into(), "EM-US-EAST".into());
        let service = build_service(&c).unwrap();
        let signals = rt().block_on(service.get_signals(&regions(&["zone-a"]), now_timestamp()));
        let _ = std::fs::remove_file(&path);
        assert_eq!(signals[0].carbon_g_per_kwh, 123.0);
        assert_eq!(signals[0].forecast_g_per_kwh, Some(111.0));
    }

    #[test]
    fn live_reload_reads_the_fixture_on_every_call() {
        let path = temp_json(
            "rilot-live-reload",
            r#"{"zones": {"zone-a": {"carbonIntensity": 100}}}"#,
        );
        let mut c = cfg(
            r#"{"provider": "electricitymap-local", "electricitymap_local_live_reload": true}"#,
        );
        c.electricitymap_local_fixture = Some(path.to_string_lossy().into());
        let service = build_service(&c).unwrap();
        let rt = rt();
        let first = rt.block_on(service.get_signals(&regions(&["zone-a"]), now_timestamp()));
        std::fs::write(&path, r#"{"zones": {"zone-a": {"carbonIntensity": 250}}}"#).unwrap();
        let second = rt.block_on(service.get_signals(&regions(&["zone-a"]), now_timestamp()));
        let _ = std::fs::remove_file(&path);
        assert_eq!(first[0].carbon_g_per_kwh, 100.0);
        assert_eq!(second[0].carbon_g_per_kwh, 250.0);
    }

    #[test]
    fn unknown_provider_is_rejected() {
        let error = match build_service(&cfg(r#"{"provider": "nope"}"#)) {
            Ok(_) => panic!("unknown provider should be rejected"),
            Err(error) => error.to_string(),
        };
        assert!(error.contains("unknown carbon provider"), "{error}");
    }
}
