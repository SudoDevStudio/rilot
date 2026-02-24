use anyhow::{Context, Result};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::{collections::{HashMap, HashSet}, env, sync::RwLock};
use wasmtime::{Engine, Store, Config as WasmtimeConfig};
use wasmtime::component::{Component, Linker, ResourceTable, TypedFunc};
use wasmtime_wasi::{
    add_to_linker_async as wasi_add,
    pipe::{MemoryInputPipe, MemoryOutputPipe},
    WasiCtx,
    WasiCtxBuilder,
    WasiView,
};
use wasmtime_wasi_io::IoView;
use wasmtime_wasi_http::{
    add_only_http_to_linker_async,
    WasiHttpCtx,
    WasiHttpView,
};

#[derive(Deserialize, Serialize, Debug, Default, Clone)]
pub struct WasmOutput {
    pub app_url: Option<String>,
    #[serde(default)]
    pub headers_to_update: HashMap<String, String>,
    #[serde(default)]
    pub headers_to_remove: Vec<String>,
    #[serde(default)]
    pub response_headers_to_add: HashMap<String, String>,
    #[serde(default)]
    pub response_headers_to_remove: Vec<String>,
    #[serde(default)]
    pub energy_joules_override: Option<f64>,
    #[serde(default)]
    pub carbon_intensity_g_per_kwh_override: Option<f64>,
    #[serde(default)]
    pub energy_source: Option<String>,
}

struct Host {
    table: ResourceTable,
    wasi: WasiCtx,
    http: WasiHttpCtx,
}

impl IoView for Host { fn table(&mut self) -> &mut ResourceTable { &mut self.table } }
impl WasiView for Host { fn ctx(&mut self) -> &mut WasiCtx { &mut self.wasi } }
impl WasiHttpView for Host { fn ctx(&mut self) -> &mut WasiHttpCtx { &mut self.http } }

static ENGINE: Lazy<Engine> = Lazy::new(|| {
    Engine::new(&WasmtimeConfig::new().async_support(true).wasm_component_model(true)).unwrap()
});

static COMPONENT_CACHE: Lazy<RwLock<HashMap<String, Component>>> =
    Lazy::new(|| RwLock::new(HashMap::new()));

static PROD_MODE: Lazy<bool> = Lazy::new(|| {
    env::var("RILOT_ENV")
        .map(|val| val.eq_ignore_ascii_case("production"))
        .unwrap_or(false)
});

pub fn is_production_mode() -> bool {
    *PROD_MODE
}

fn load_component(component_path: &str, use_cache: bool) -> Result<Component> {
    if use_cache {
        let read_cache = COMPONENT_CACHE.read().expect("Cache lock poisoned");
        if let Some(comp) = read_cache.get(component_path) {
            return Ok(comp.clone());
        }
        drop(read_cache);

        let comp = Component::from_file(&*ENGINE, component_path)
            .with_context(|| format!("Failed to load Wasm component file: {}", component_path))?;
        let mut write_cache = COMPONENT_CACHE.write().expect("Cache lock poisoned");
        write_cache.insert(component_path.to_string(), comp.clone());
        Ok(comp)
    } else {
        Component::from_file(&*ENGINE, component_path)
            .with_context(|| format!("Failed to load Wasm component file: {}", component_path))
    }
}

pub fn preload_components(paths: &[String]) -> Result<usize> {
    if !is_production_mode() {
        return Ok(0);
    }

    let mut unique = HashSet::new();
    for path in paths {
        if path.trim().is_empty() || !unique.insert(path.clone()) {
            continue;
        }
        let _ = load_component(path, true)?;
    }
    Ok(unique.len())
}

pub async fn run_modify_request(component_path: &str, input_json: &str) -> Result<WasmOutput> {
    let component = if is_production_mode() {
        log::debug!("[Prod Mode] Loading component from in-memory cache: {}", component_path);
        load_component(component_path, true)?
    } else {
        log::debug!("[Dev Mode] Compiling component (no cache): {}", component_path);
        load_component(component_path, false)?
    };
    log::debug!("Component loaded/retrieved.");

    log::debug!("Creating I/O pipes...");
    let input_json_owned = input_json.to_string();
    let stdin_pipe = MemoryInputPipe::new(input_json_owned);
    let stdout_pipe = MemoryOutputPipe::new(4096);

    log::debug!("Building WASI context with pipes...");
    let mut builder = WasiCtxBuilder::new();
    builder
        .inherit_args()
        .inherit_env()
        .stdin(stdin_pipe.clone())
        .stdout(stdout_pipe.clone())
        .inherit_stderr();

    let wasi_ctx = builder.build();
    let host = Host {
        table: ResourceTable::default(),
        wasi: wasi_ctx,
        http: WasiHttpCtx::new(),
    };
    let mut store = Store::new(&*ENGINE, host);
    log::debug!("Host and Store created.");

    let mut linker = Linker::new(&*ENGINE);

    wasi_add(&mut linker)?;
    add_only_http_to_linker_async(&mut linker)?;
    log::debug!("WASI interfaces linked.");

    log::debug!("Instantiating component...");
    let instance = linker.instantiate_async(&mut store, &component).await?;
    log::debug!("Component instantiated.");

    let actual_export_name = "modify-request";

    log::debug!("Finding function export named '{}'...", actual_export_name);

    let modify_request_func: TypedFunc<(), ()> = instance
        .get_typed_func(&mut store, actual_export_name)
        .with_context(|| format!("Failed to find expected function export '{}'", actual_export_name))?;
    log::debug!("Found `{}` function export.", actual_export_name);


    log::debug!("Calling `{}` in Wasm (I/O via stdio pipes)...", actual_export_name);
    modify_request_func
        .call_async(&mut store, ())
        .await
        .with_context(|| format!("Failed during Wasm function call '{}'", actual_export_name))?
        ;
    log::debug!("`{}` returned.", actual_export_name);

    drop(store);
    let output_bytes = stdout_pipe.contents();
    let output_json_string = String::from_utf8(output_bytes.to_vec())
        .context("Failed to decode Wasm stdout as UTF-8")?;

    log::debug!("Read output JSON string from stdout pipe ({} bytes)", output_json_string.len());
    log::trace!("Raw stdout: {}", output_json_string);


    let output: WasmOutput = if output_json_string.trim().is_empty() {
        log::warn!("Wasm component wrote empty string to stdout, returning default output.");
        WasmOutput::default()
    } else {
        serde_json::from_str(&output_json_string).with_context(|| format!("Failed to parse JSON output from Wasm stdout: '{}'", output_json_string))?
    };
    log::debug!("Deserialized WasmOutput: {:?}", output);

    Ok(output)
}
