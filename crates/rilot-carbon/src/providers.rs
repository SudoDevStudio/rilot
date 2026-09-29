//! Carbon providers. Each one owns the translation from canonical Rilot
//! regions to whatever identifiers its source uses; those never leak out.

use crate::service::{CarbonProvider, ProviderContext, SignalsFuture};
use anyhow::{anyhow, Context};
use rilot_core::{CarbonSignal, SignalSource, Timestamp};
use std::collections::HashMap;
use std::path::PathBuf;

/// Fixed values per region: tests, demos, and offline research runs.
pub struct StaticProvider {
    values: HashMap<String, f64>,
    forecasts: HashMap<String, f64>,
    /// Slowly drift values over time (the legacy `mock` provider).
    drift: bool,
}

impl StaticProvider {
    pub fn new(values: HashMap<String, f64>) -> Self {
        StaticProvider {
            values,
            forecasts: HashMap::new(),
            drift: false,
        }
    }

    pub fn with_forecasts(mut self, forecasts: HashMap<String, f64>) -> Self {
        self.forecasts = forecasts;
        self
    }

    pub fn with_drift(mut self, drift: bool) -> Self {
        self.drift = drift;
        self
    }

    pub fn signals_at(&self, regions: &[String], now: Timestamp) -> Vec<CarbonSignal> {
        let wave = if self.drift {
            (now.unix_seconds() as f64 / 300.0).sin() * 0.08
        } else {
            0.0
        };
        regions
            .iter()
            .filter_map(|region| {
                let base = self.values.get(region).copied()?;
                let current = (base * (1.0 + wave)).max(0.0);
                Some(CarbonSignal {
                    region: region.clone(),
                    carbon_g_per_kwh: current,
                    observed_at: now,
                    forecast_g_per_kwh: self.forecasts.get(region).copied(),
                    source: Some(SignalSource::Mock),
                })
            })
            .collect()
    }
}

impl CarbonProvider for StaticProvider {
    fn name(&self) -> &str {
        "static"
    }

    fn fetch<'a>(&'a self, regions: &'a [String], ctx: ProviderContext) -> SignalsFuture<'a> {
        Box::pin(async move { Ok(self.signals_at(regions, ctx.now)) })
    }
}

/// Generic provider: the source already returns Rilot's normalized format.
///
/// ```json
/// {"signals": [{"region": "us-east-1", "carbon_g_per_kwh": 245, "observed_at": "..."}]}
/// ```
pub struct JsonProvider {
    source: String,
}

#[derive(serde::Deserialize)]
struct SignalDocument {
    signals: Vec<CarbonSignal>,
}

pub fn parse_signal_document(text: &str) -> anyhow::Result<Vec<CarbonSignal>> {
    let doc: SignalDocument = serde_json::from_str(text).context("invalid carbon signal JSON")?;
    for signal in &doc.signals {
        if signal.region.trim().is_empty() {
            return Err(anyhow!("carbon signal with empty region"));
        }
        if !signal.carbon_g_per_kwh.is_finite() || signal.carbon_g_per_kwh < 0.0 {
            return Err(anyhow!(
                "carbon signal for {} has invalid carbon_g_per_kwh",
                signal.region
            ));
        }
    }
    Ok(doc.signals)
}

impl JsonProvider {
    pub fn new(source: impl Into<String>) -> Self {
        JsonProvider {
            source: source.into(),
        }
    }
}

impl CarbonProvider for JsonProvider {
    fn name(&self) -> &str {
        "json"
    }

    fn fetch<'a>(&'a self, regions: &'a [String], _ctx: ProviderContext) -> SignalsFuture<'a> {
        Box::pin(async move {
            let text = if self.source.starts_with("http://") || self.source.starts_with("https://")
            {
                reqwest::get(&self.source)
                    .await?
                    .error_for_status()?
                    .text()
                    .await?
            } else {
                std::fs::read_to_string(&self.source)
                    .with_context(|| format!("reading {}", self.source))?
            };
            Ok(parse_signal_document(&text)?
                .into_iter()
                .filter(|s| regions.contains(&s.region))
                .map(|mut s| {
                    s.source = Some(SignalSource::Json);
                    s
                })
                .collect())
        })
    }
}

/// Built-in Rilot region → Electricity Maps zone mapping (provider-internal).
pub const ELECTRICITYMAPS_ZONES: &[(&str, &str)] = &[
    ("us-east-1", "US-MIDA-PJM"),
    ("us-east-2", "US-MIDA-PJM"),
    ("us-west-1", "US-CAL-CISO"),
    ("us-west-2", "US-NW-BPAT"),
    ("ca-central-1", "CA-QC"),
    ("sa-east-1", "BR-CS"),
    ("eu-west-1", "IE"),
    ("eu-west-2", "GB"),
    ("eu-west-3", "FR"),
    ("eu-central-1", "DE"),
    ("eu-north-1", "SE-SE3"),
    ("eu-south-1", "IT-NO"),
    ("ap-south-1", "IN-WE"),
    ("ap-southeast-1", "SG"),
    ("ap-southeast-2", "AU-NSW"),
    ("ap-northeast-1", "JP-TK"),
    ("ap-northeast-2", "KR"),
    ("us-east4", "US-MIDA-PJM"),
    ("us-central1", "US-MIDW-MISO"),
    ("us-west1", "US-NW-BPAT"),
    ("europe-west1", "BE"),
    ("europe-west4", "NL"),
    ("eastus", "US-MIDA-PJM"),
    ("northeurope", "IE"),
    ("uksouth", "GB"),
];

pub fn electricitymaps_zone<'a>(
    overrides: &'a HashMap<String, String>,
    region: &'a str,
) -> &'a str {
    overrides
        .get(region)
        .map(String::as_str)
        .or_else(|| {
            ELECTRICITYMAPS_ZONES
                .iter()
                .find(|(r, _)| r.eq_ignore_ascii_case(region))
                .map(|(_, zone)| *zone)
        })
        .unwrap_or(region)
}

pub struct ElectricityMapsProvider {
    api_key: String,
    base_url: String,
    token_header: String,
    zone_overrides: HashMap<String, String>,
    disable_estimations: bool,
    client: reqwest::Client,
}

impl ElectricityMapsProvider {
    pub fn new(api_key: impl Into<String>) -> Self {
        ElectricityMapsProvider {
            api_key: api_key.into(),
            base_url: "https://api.electricitymap.org".to_string(),
            token_header: "auth-token".to_string(),
            zone_overrides: HashMap::new(),
            disable_estimations: false,
            client: reqwest::Client::new(),
        }
    }

    pub fn with_base_url(mut self, base_url: impl Into<String>) -> Self {
        self.base_url = base_url.into().trim_end_matches('/').to_string();
        self
    }

    pub fn with_token_header(mut self, header: impl Into<String>) -> Self {
        self.token_header = header.into();
        self
    }

    pub fn with_zone_overrides(mut self, overrides: HashMap<String, String>) -> Self {
        self.zone_overrides = overrides;
        self
    }

    pub fn with_disable_estimations(mut self, disable: bool) -> Self {
        self.disable_estimations = disable;
        self
    }

    async fn fetch_one(&self, region: &str, now: Timestamp) -> anyhow::Result<CarbonSignal> {
        let zone = electricitymaps_zone(&self.zone_overrides, region);
        let url = format!(
            "{}/v3/carbon-intensity/latest?zone={}&disableEstimations={}",
            self.base_url, zone, self.disable_estimations
        );
        let data: serde_json::Value = self
            .client
            .get(url)
            .header(self.token_header.as_str(), self.api_key.as_str())
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        signal_from_response(region, &data, SignalSource::Live, now)
            .ok_or_else(|| anyhow!("no carbonIntensity for zone {zone}"))
    }
}

impl CarbonProvider for ElectricityMapsProvider {
    fn name(&self) -> &str {
        "electricitymap"
    }

    fn fetch<'a>(&'a self, regions: &'a [String], ctx: ProviderContext) -> SignalsFuture<'a> {
        Box::pin(async move {
            let mut out = Vec::new();
            for region in regions {
                match self.fetch_one(region, ctx.now).await {
                    Ok(signal) => out.push(signal),
                    Err(error) => {
                        log::warn!("electricitymap_request_failed region={region} error={error:#}")
                    }
                }
            }
            Ok(out)
        })
    }
}

/// Reads Electricity Maps-shaped responses from a local fixture file, for
/// offline and reproducible research runs.
pub struct ElectricityMapsLocalProvider {
    fixture: PathBuf,
    zone_overrides: HashMap<String, String>,
    forecasts: HashMap<String, f64>,
}

impl ElectricityMapsLocalProvider {
    pub fn new(fixture: impl Into<PathBuf>) -> Self {
        ElectricityMapsLocalProvider {
            fixture: fixture.into(),
            zone_overrides: HashMap::new(),
            forecasts: HashMap::new(),
        }
    }

    pub fn with_zone_overrides(mut self, overrides: HashMap<String, String>) -> Self {
        self.zone_overrides = overrides;
        self
    }

    pub fn with_forecasts(mut self, forecasts: HashMap<String, f64>) -> Self {
        self.forecasts = forecasts;
        self
    }

    fn read(&self, regions: &[String], now: Timestamp) -> Vec<CarbonSignal> {
        let Some(doc) = std::fs::read_to_string(&self.fixture)
            .ok()
            .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        else {
            log::warn!(
                "electricitymap_local_fixture_unreadable path={}",
                self.fixture.display()
            );
            return Vec::new();
        };
        regions
            .iter()
            .filter_map(|region| {
                let zone = electricitymaps_zone(&self.zone_overrides, region);
                let obj = doc.get("zones").and_then(|z| z.get(zone)).unwrap_or(&doc);
                let mut signal = signal_from_response(region, obj, SignalSource::Json, now)?;
                // The fixture timestamp is historical; offline runs care about
                // the value, so it is treated as observed now.
                signal.observed_at = now;
                if signal.forecast_g_per_kwh.is_none() {
                    signal.forecast_g_per_kwh = self.forecasts.get(region).copied();
                }
                Some(signal)
            })
            .collect()
    }
}

impl CarbonProvider for ElectricityMapsLocalProvider {
    fn name(&self) -> &str {
        "electricitymap-local"
    }

    fn fetch<'a>(&'a self, regions: &'a [String], ctx: ProviderContext) -> SignalsFuture<'a> {
        Box::pin(async move { Ok(self.read(regions, ctx.now)) })
    }
}

fn number(value: Option<&serde_json::Value>) -> Option<f64> {
    value
        .and_then(|v| v.as_f64())
        .filter(|v| v.is_finite() && *v >= 0.0)
}

fn signal_from_response(
    region: &str,
    data: &serde_json::Value,
    source: SignalSource,
    now: Timestamp,
) -> Option<CarbonSignal> {
    let current = number(data.get("carbonIntensity"))?;
    let observed_at = data
        .get("datetime")
        .and_then(|v| v.as_str())
        .and_then(|s| Timestamp::parse_rfc3339(s).ok())
        .unwrap_or(now);
    Some(CarbonSignal {
        region: region.to_string(),
        carbon_g_per_kwh: current,
        observed_at,
        forecast_g_per_kwh: number(data.get("carbonIntensityForecast")),
        source: Some(source),
    })
}
