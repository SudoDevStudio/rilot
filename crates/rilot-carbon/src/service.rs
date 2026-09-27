use rilot_carbon_policy::{merge, plan, CarbonPolicy, MergeInput, PlanInput};
use rilot_core::{CarbonSignal, SignalSource, Timestamp};
use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

pub const DEFAULT_MAX_AGE_SECONDS: u64 = 300;
pub const DEFAULT_TIMEOUT_MS: u64 = 1500;

pub type SignalsFuture<'a> =
    Pin<Box<dyn Future<Output = anyhow::Result<Vec<CarbonSignal>>> + Send + 'a>>;
pub type StoreGetFuture<'a> =
    Pin<Box<dyn Future<Output = HashMap<String, CarbonSignal>> + Send + 'a>>;
pub type StorePutFuture<'a> = Pin<Box<dyn Future<Output = ()> + Send + 'a>>;

#[derive(Debug, Clone, Copy)]
pub struct ProviderContext {
    pub now: Timestamp,
    pub timeout: Duration,
}

/// Fetches signals for canonical Rilot regions.
///
/// Return only the regions that resolved; a missing region means "unavailable"
/// and is never an error.
pub trait CarbonProvider: Send + Sync {
    fn name(&self) -> &str;
    fn fetch<'a>(&'a self, regions: &'a [String], ctx: ProviderContext) -> SignalsFuture<'a>;
}

/// A cache layer. Ordered fastest first when several are used.
pub trait CarbonStore: Send + Sync {
    fn name(&self) -> &str;
    /// Label applied to signals served from this store.
    fn served_source(&self) -> Option<SignalSource> {
        None
    }
    fn get<'a>(&'a self, regions: &'a [String]) -> StoreGetFuture<'a>;
    fn put<'a>(&'a self, signals: &'a [CarbonSignal], ttl_seconds: u64) -> StorePutFuture<'a>;
}

#[derive(Debug, Clone, Copy)]
pub struct CachePolicy {
    /// Freshness rules, shared with edge/browser hosts through Wasm.
    pub rules: CarbonPolicy,
    pub timeout: Duration,
    pub store_ttl_seconds: u64,
}

impl CachePolicy {
    pub fn max_age_seconds(&self) -> u64 {
        self.rules.max_age_seconds
    }

    pub fn refresh_seconds(&self) -> u64 {
        self.rules.refresh_seconds
    }
}

impl Default for CachePolicy {
    fn default() -> Self {
        CachePolicy::new(DEFAULT_MAX_AGE_SECONDS, None, None)
    }
}

impl CachePolicy {
    pub fn new(
        max_age_seconds: u64,
        refresh_seconds: Option<u64>,
        timeout_ms: Option<u64>,
    ) -> Self {
        CachePolicy {
            rules: CarbonPolicy {
                max_age_seconds,
                refresh_seconds: refresh_seconds.unwrap_or_else(|| max_age_seconds.min(60)),
            },
            timeout: Duration::from_millis(timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS).max(1)),
            store_ttl_seconds: (max_age_seconds * 12).max(60),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum CarbonEvent {
    StoreHit {
        region: String,
        store: String,
        age_seconds: i64,
    },
    StaleServed {
        region: String,
        age_seconds: i64,
    },
    Miss {
        regions: Vec<String>,
    },
    ProviderOk {
        provider: String,
        regions: Vec<String>,
    },
    ProviderError {
        provider: String,
        regions: Vec<String>,
        error: String,
    },
    StoreWrite {
        store: String,
        regions: Vec<String>,
    },
    RefreshScheduled {
        regions: Vec<String>,
    },
}

type EventSink = Arc<dyn Fn(CarbonEvent) + Send + Sync>;
/// Runs work that must not block the response (background refresh, store writes).
type Spawner = Arc<dyn Fn(Pin<Box<dyn Future<Output = ()> + Send>>) + Send + Sync>;

#[derive(Default)]
pub struct CarbonServiceBuilder {
    provider: Option<Arc<dyn CarbonProvider>>,
    stores: Vec<Arc<dyn CarbonStore>>,
    policy: Option<CachePolicy>,
    events: Option<EventSink>,
    spawner: Option<Spawner>,
}

impl CarbonServiceBuilder {
    pub fn provider(mut self, provider: Arc<dyn CarbonProvider>) -> Self {
        self.provider = Some(provider);
        self
    }

    pub fn maybe_provider(mut self, provider: Option<Arc<dyn CarbonProvider>>) -> Self {
        self.provider = provider;
        self
    }

    pub fn store(mut self, store: Arc<dyn CarbonStore>) -> Self {
        self.stores.push(store);
        self
    }

    pub fn policy(mut self, policy: CachePolicy) -> Self {
        self.policy = Some(policy);
        self
    }

    pub fn on_event(mut self, sink: EventSink) -> Self {
        self.events = Some(sink);
        self
    }

    pub fn spawner(mut self, spawner: Spawner) -> Self {
        self.spawner = Some(spawner);
        self
    }

    pub fn build(self) -> Arc<CarbonService> {
        Arc::new(CarbonService {
            provider: self.provider,
            stores: self.stores,
            policy: self.policy.unwrap_or_default(),
            events: self.events,
            spawner: self.spawner,
        })
    }
}

pub struct CarbonService {
    provider: Option<Arc<dyn CarbonProvider>>,
    stores: Vec<Arc<dyn CarbonStore>>,
    policy: CachePolicy,
    events: Option<EventSink>,
    spawner: Option<Spawner>,
}

impl CarbonService {
    pub fn builder() -> CarbonServiceBuilder {
        CarbonServiceBuilder::default()
    }

    pub fn policy(&self) -> CachePolicy {
        self.policy
    }

    pub fn provider_name(&self) -> &str {
        self.provider.as_ref().map(|p| p.name()).unwrap_or("none")
    }

    fn emit(&self, event: CarbonEvent) {
        if let Some(sink) = &self.events {
            sink(event);
        }
    }

    /// Runs work that should not block the caller. Without a spawner the work
    /// is awaited inline, so nothing is silently dropped.
    async fn schedule(self: &Arc<Self>, work: Pin<Box<dyn Future<Output = ()> + Send>>) {
        match &self.spawner {
            Some(spawner) => spawner(work),
            None => work.await,
        }
    }

    /// Returns the freshest signal available for each requested region.
    ///
    /// Fresh cache hit → served. Past the refresh age but within `max_age`
    /// → served and refreshed in the background. Older, or missing → the
    /// provider is called; if that fails the stale value is returned and
    /// `rilot-core` decides it is too old to route on.
    pub async fn get_signals(
        self: &Arc<Self>,
        regions: &[String],
        now: Timestamp,
    ) -> Vec<CarbonSignal> {
        if regions.is_empty() {
            return Vec::new();
        }
        // Every decision here comes from rilot-carbon-policy; this function
        // only performs the I/O the policy asks for.
        let cached = self.read_stores(regions, now).await;
        let planned = plan(&PlanInput {
            policy: self.policy.rules,
            now,
            regions: regions.to_vec(),
            cached: cached.clone(),
        });

        let mut fetched = Vec::new();
        if !planned.fetch.is_empty() {
            self.emit(CarbonEvent::Miss {
                regions: planned.fetch.clone(),
            });
            fetched = self.call_provider(&planned.fetch, now).await;
        }

        let merged = merge(&MergeInput {
            policy: self.policy.rules,
            now,
            regions: regions.to_vec(),
            serve: planned.serve,
            fetched,
            cached,
        });

        for region in &merged.stale_served {
            self.emit(CarbonEvent::StaleServed {
                region: region.clone(),
                age_seconds: self.policy.max_age_seconds() as i64,
            });
        }

        if !merged.store_writes.is_empty() {
            let service = Arc::clone(self);
            let writes = merged.store_writes.clone();
            self.schedule(Box::pin(async move { service.write(&writes).await }))
                .await;
        }

        if !planned.refresh.is_empty() {
            self.emit(CarbonEvent::RefreshScheduled {
                regions: planned.refresh.clone(),
            });
            let service = Arc::clone(self);
            let refresh_regions = planned.refresh;
            self.schedule(Box::pin(async move {
                let refreshed = service.call_provider(&refresh_regions, now).await;
                if !refreshed.is_empty() {
                    service.write(&refreshed).await;
                }
            }))
            .await;
        }

        merged.signals
    }

    /// Reads stores in order; the first store holding a region wins.
    async fn read_stores(&self, regions: &[String], now: Timestamp) -> Vec<CarbonSignal> {
        let mut found: Vec<CarbonSignal> = Vec::new();
        let mut remaining: Vec<String> = regions.to_vec();
        for store in &self.stores {
            if remaining.is_empty() {
                break;
            }
            let entries = store.get(&remaining).await;
            let mut still_missing = Vec::new();
            for region in remaining {
                match entries.get(&region) {
                    Some(signal) => {
                        self.emit(CarbonEvent::StoreHit {
                            region: region.clone(),
                            store: store.name().to_string(),
                            age_seconds: now.seconds_since(signal.observed_at).max(0),
                        });
                        let mut signal = signal.clone();
                        if let Some(source) = store.served_source() {
                            signal.source = Some(source);
                        }
                        found.push(signal);
                    }
                    None => still_missing.push(region),
                }
            }
            remaining = still_missing;
        }
        found
    }

    async fn call_provider(&self, regions: &[String], now: Timestamp) -> Vec<CarbonSignal> {
        let mut out: Vec<CarbonSignal> = Vec::new();
        let Some(provider) = &self.provider else {
            return out;
        };
        let ctx = ProviderContext {
            now,
            timeout: self.policy.timeout,
        };
        match tokio::time::timeout(self.policy.timeout, provider.fetch(regions, ctx)).await {
            Ok(Ok(signals)) => {
                // Validation and filtering are the policy's job; hand over
                // whatever the provider returned.
                out = signals;
                self.emit(CarbonEvent::ProviderOk {
                    provider: provider.name().to_string(),
                    regions: out.iter().map(|s| s.region.clone()).collect(),
                });
            }
            Ok(Err(error)) => self.emit(CarbonEvent::ProviderError {
                provider: provider.name().to_string(),
                regions: regions.to_vec(),
                error: format!("{error:#}"),
            }),
            Err(_) => self.emit(CarbonEvent::ProviderError {
                provider: provider.name().to_string(),
                regions: regions.to_vec(),
                error: "provider timed out".to_string(),
            }),
        }
        out
    }

    async fn write(&self, signals: &[CarbonSignal]) {
        for store in &self.stores {
            store.put(signals, self.policy.store_ttl_seconds).await;
            self.emit(CarbonEvent::StoreWrite {
                store: store.name().to_string(),
                regions: signals.iter().map(|s| s.region.clone()).collect(),
            });
        }
    }
}
