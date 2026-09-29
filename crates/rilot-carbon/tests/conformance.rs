//! Shared carbon-layer conformance suite (`fixtures/carbon/*.json`).
//! The TypeScript implementation (`packages/rilot-carbon`) runs the same files.

use rilot_carbon::service::{
    CachePolicy, CarbonEvent, CarbonProvider, CarbonService, CarbonStore, ProviderContext,
    SignalsFuture, StoreGetFuture, StorePutFuture,
};
use rilot_carbon::{CarbonSignal, MemoryStore, SignalSource, Timestamp};
use serde::Deserialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

#[derive(Debug, Deserialize)]
struct Fixture {
    name: String,
    #[allow(dead_code)]
    description: String,
    now: Timestamp,
    policy: PolicyFixture,
    #[serde(default)]
    stores: StoresFixture,
    #[serde(default)]
    provider: ProviderFixture,
    request: Vec<String>,
    expect: ExpectFixture,
}

#[derive(Debug, Deserialize)]
struct PolicyFixture {
    max_age_seconds: u64,
    refresh_seconds: u64,
}

#[derive(Debug, Default, Deserialize)]
struct StoresFixture {
    #[serde(default)]
    memory: Vec<CarbonSignal>,
    #[serde(default)]
    kv: Vec<CarbonSignal>,
}

#[derive(Debug, Default, Deserialize)]
struct ProviderFixture {
    #[serde(default)]
    signals: Vec<CarbonSignal>,
    #[serde(default)]
    fail: bool,
}

#[derive(Debug, Deserialize)]
struct ExpectFixture {
    signals: Vec<ExpectedSignal>,
    provider_called_with: Vec<String>,
    refreshed: Vec<String>,
    #[serde(default)]
    store_writes: HashMap<String, Vec<String>>,
}

#[derive(Debug, Deserialize)]
struct ExpectedSignal {
    region: String,
    carbon_g_per_kwh: f64,
    #[serde(default)]
    source: Option<SignalSource>,
}

/// Records what it was asked for, and answers from the fixture script.
struct ScriptedProvider {
    script: ProviderFixture,
    calls: Mutex<Vec<String>>,
}

impl CarbonProvider for ScriptedProvider {
    fn name(&self) -> &str {
        "scripted"
    }

    fn fetch<'a>(&'a self, regions: &'a [String], _ctx: ProviderContext) -> SignalsFuture<'a> {
        Box::pin(async move {
            self.calls
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .extend(regions.iter().cloned());
            if self.script.fail {
                return Err(anyhow::anyhow!("provider unavailable"));
            }
            Ok(self.script.signals.clone())
        })
    }
}

/// Stands in for Workers KV: durable, labels what it serves, logs writes.
#[derive(Default)]
struct RecordingKvStore {
    entries: Mutex<HashMap<String, CarbonSignal>>,
    writes: Mutex<Vec<String>>,
}

impl CarbonStore for RecordingKvStore {
    fn name(&self) -> &str {
        "kv"
    }

    fn served_source(&self) -> Option<SignalSource> {
        Some(SignalSource::LastKnownGood)
    }

    fn get<'a>(&'a self, regions: &'a [String]) -> StoreGetFuture<'a> {
        Box::pin(async move {
            let entries = self.entries.lock().unwrap_or_else(|p| p.into_inner());
            regions
                .iter()
                .filter_map(|r| entries.get(r).map(|s| (r.clone(), s.clone())))
                .collect()
        })
    }

    fn put<'a>(&'a self, signals: &'a [CarbonSignal], _ttl: u64) -> StorePutFuture<'a> {
        Box::pin(async move {
            let mut entries = self.entries.lock().unwrap_or_else(|p| p.into_inner());
            let mut writes = self.writes.lock().unwrap_or_else(|p| p.into_inner());
            for signal in signals {
                entries.insert(signal.region.clone(), signal.clone());
                writes.push(signal.region.clone());
            }
        })
    }
}

/// Wraps MemoryStore so writes can be asserted.
struct RecordingMemoryStore {
    inner: MemoryStore,
    writes: Mutex<Vec<String>>,
}

impl CarbonStore for RecordingMemoryStore {
    fn name(&self) -> &str {
        "memory"
    }

    fn served_source(&self) -> Option<SignalSource> {
        Some(SignalSource::LocalCache)
    }

    fn get<'a>(&'a self, regions: &'a [String]) -> StoreGetFuture<'a> {
        self.inner.get(regions)
    }

    fn put<'a>(&'a self, signals: &'a [CarbonSignal], ttl: u64) -> StorePutFuture<'a> {
        Box::pin(async move {
            self.writes
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .extend(signals.iter().map(|s| s.region.clone()));
            self.inner.put(signals, ttl).await;
        })
    }
}

type BackgroundWork = std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>>;

fn sorted(values: &[String]) -> Vec<String> {
    let mut out: Vec<String> = values.to_vec();
    out.sort();
    out.dedup();
    out
}

fn fixture_files() -> Vec<PathBuf> {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/carbon");
    let mut files: Vec<PathBuf> = std::fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("read {}: {e}", dir.display()))
        .map(|entry| entry.expect("dir entry").path())
        .filter(|p| p.extension().is_some_and(|e| e == "json"))
        .collect();
    files.sort();
    assert!(!files.is_empty(), "no carbon fixtures in {}", dir.display());
    files
}

#[test]
fn carbon_layer_conformance() {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("tokio runtime");
    let mut failures = Vec::new();

    for path in fixture_files() {
        let raw = std::fs::read_to_string(&path).expect("read fixture");
        let fixture: Fixture =
            serde_json::from_str(&raw).unwrap_or_else(|e| panic!("{}: {e}", path.display()));

        let provider = Arc::new(ScriptedProvider {
            script: ProviderFixture {
                signals: fixture.provider.signals.clone(),
                fail: fixture.provider.fail,
            },
            calls: Mutex::new(Vec::new()),
        });
        let memory = Arc::new(RecordingMemoryStore {
            inner: MemoryStore::new(),
            writes: Mutex::new(Vec::new()),
        });
        memory.inner.seed(fixture.stores.memory.clone());
        let kv = Arc::new(RecordingKvStore::default());
        runtime.block_on(kv.put(&fixture.stores.kv, 0));
        kv.writes.lock().unwrap().clear();

        let refreshed: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let refreshed_sink = Arc::clone(&refreshed);
        // Background work is collected and run after the call, so a refresh is
        // never counted as a direct provider call.
        let scheduled: Arc<Mutex<Vec<BackgroundWork>>> = Arc::new(Mutex::new(Vec::new()));
        let scheduled_sink = Arc::clone(&scheduled);

        let service = CarbonService::builder()
            .provider(provider.clone())
            .store(memory.clone())
            .store(kv.clone())
            .policy(CachePolicy::new(
                fixture.policy.max_age_seconds,
                Some(fixture.policy.refresh_seconds),
                None,
            ))
            .on_event(Arc::new(move |event| {
                if let CarbonEvent::RefreshScheduled { regions } = event {
                    refreshed_sink
                        .lock()
                        .unwrap_or_else(|p| p.into_inner())
                        .extend(regions);
                }
            }))
            .spawner(Arc::new(move |work| {
                scheduled_sink
                    .lock()
                    .unwrap_or_else(|p| p.into_inner())
                    .push(work)
            }))
            .build();

        let signals = runtime.block_on(service.get_signals(&fixture.request, fixture.now));
        let direct_calls = provider.calls.lock().unwrap().clone();
        runtime.block_on(async {
            loop {
                let batch: Vec<_> = scheduled.lock().unwrap().drain(..).collect();
                if batch.is_empty() {
                    break;
                }
                for work in batch {
                    work.await;
                }
            }
        });

        let actual: Vec<(String, f64, Option<SignalSource>)> = signals
            .iter()
            .map(|s| (s.region.clone(), s.carbon_g_per_kwh, s.source))
            .collect();
        let expected: Vec<(String, f64, Option<SignalSource>)> = fixture
            .expect
            .signals
            .iter()
            .map(|s| (s.region.clone(), s.carbon_g_per_kwh, s.source))
            .collect();

        let mut problems = Vec::new();
        if actual != expected {
            problems.push(format!("signals: expected {expected:?}, got {actual:?}"));
        }
        let checks = [
            (
                "provider calls",
                sorted(&direct_calls),
                sorted(&fixture.expect.provider_called_with),
            ),
            (
                "refreshed",
                sorted(&refreshed.lock().unwrap()),
                sorted(&fixture.expect.refreshed),
            ),
            (
                "memory writes",
                sorted(&memory.writes.lock().unwrap()),
                sorted(
                    fixture
                        .expect
                        .store_writes
                        .get("memory")
                        .map(Vec::as_slice)
                        .unwrap_or(&[]),
                ),
            ),
            (
                "kv writes",
                sorted(&kv.writes.lock().unwrap()),
                sorted(
                    fixture
                        .expect
                        .store_writes
                        .get("kv")
                        .map(Vec::as_slice)
                        .unwrap_or(&[]),
                ),
            ),
        ];
        for (label, got, want) in checks {
            if got != want {
                problems.push(format!("{label}: expected {want:?}, got {got:?}"));
            }
        }
        if !problems.is_empty() {
            failures.push(format!(
                "fixture {:?}:\n  {}",
                fixture.name,
                problems.join("\n  ")
            ));
        }
    }

    assert!(failures.is_empty(), "\n{}", failures.join("\n\n"));
}
