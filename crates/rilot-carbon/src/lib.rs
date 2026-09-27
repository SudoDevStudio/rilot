//! Carbon signal acquisition for Rilot adapters.
//!
//! ```text
//! CarbonService  ← the only place freshness / refresh / fallback rules live
//!    ├── CarbonProvider   where signals come from
//!    └── CarbonStore[]    where they are cached (read-through, write-back)
//! ```
//!
//! Adding a new source means implementing [`CarbonProvider`]. Providers never
//! cache, stores never fetch, and provider-specific zone ids never leave the
//! provider. `rilot-core` sees only normalized [`CarbonSignal`]s.
//!
//! The behavior of [`CarbonService`] is pinned by `fixtures/carbon/*.json`,
//! the same files the TypeScript implementation (`packages/rilot-carbon`) runs.

pub mod providers;
pub mod service;
pub mod stores;

pub use providers::{
    ElectricityMapsLocalProvider, ElectricityMapsProvider, JsonProvider, StaticProvider,
};
pub use service::{
    CachePolicy, CarbonEvent, CarbonProvider, CarbonService, CarbonStore, ProviderContext,
    SignalsFuture, StoreGetFuture, StorePutFuture, DEFAULT_MAX_AGE_SECONDS, DEFAULT_TIMEOUT_MS,
};
pub use stores::MemoryStore;

pub use rilot_core::{CarbonSignal, SignalSource, Timestamp};
