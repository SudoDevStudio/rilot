use crate::service::{CarbonStore, StoreGetFuture, StorePutFuture};
use rilot_core::{CarbonSignal, SignalSource};
use std::collections::HashMap;
use std::sync::RwLock;

/// Process-local cache. Fast, and the only store native Rilot needs by default.
#[derive(Default)]
pub struct MemoryStore {
    entries: RwLock<HashMap<String, CarbonSignal>>,
}

impl MemoryStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn clear(&self) {
        self.entries
            .write()
            .unwrap_or_else(|p| p.into_inner())
            .clear();
    }

    pub fn seed(&self, signals: impl IntoIterator<Item = CarbonSignal>) {
        let mut entries = self.entries.write().unwrap_or_else(|p| p.into_inner());
        for signal in signals {
            entries.insert(signal.region.clone(), signal);
        }
    }
}

impl CarbonStore for MemoryStore {
    fn name(&self) -> &str {
        "memory"
    }

    fn served_source(&self) -> Option<SignalSource> {
        Some(SignalSource::LocalCache)
    }

    fn get<'a>(&'a self, regions: &'a [String]) -> StoreGetFuture<'a> {
        Box::pin(async move {
            let entries = self.entries.read().unwrap_or_else(|p| p.into_inner());
            regions
                .iter()
                .filter_map(|region| entries.get(region).map(|s| (region.clone(), s.clone())))
                .collect()
        })
    }

    fn put<'a>(&'a self, signals: &'a [CarbonSignal], _ttl_seconds: u64) -> StorePutFuture<'a> {
        Box::pin(async move {
            let mut entries = self.entries.write().unwrap_or_else(|p| p.into_inner());
            for signal in signals {
                entries.insert(signal.region.clone(), signal.clone());
            }
        })
    }
}
