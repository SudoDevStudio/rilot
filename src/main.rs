use std::env;
use std::sync::Arc;
mod carbon;
mod config;
mod proxy;
mod wasm_engine;

#[tokio::main]
async fn main() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    let args: Vec<String> = env::args().collect();
    let config_path = args.get(1).map_or("./config.json", |p| p.as_str());

    log::info!("Loading configuration from: {}", config_path);

    let cfg = config::load_config(config_path);
    log::info!(
        "Configuration loaded ({} format): {} backend(s), {} routing rule(s).",
        if cfg.require_rule_match {
            "legacy proxies"
        } else {
            "simple"
        },
        cfg.routing.backends.len(),
        cfg.routing.routing_rules.len()
    );

    if wasm_engine::is_production_mode() {
        let override_paths = cfg.override_files();
        if !override_paths.is_empty() {
            match wasm_engine::preload_components(&override_paths) {
                Ok(count) => log::info!("Preloaded {} Wasm component(s) into memory.", count),
                Err(e) => {
                    log::error!(
                        "Failed to preload Wasm components in production mode: {}",
                        e
                    );
                    std::process::exit(1);
                }
            }
        }
    }

    let carbon_service = carbon::build_service(&cfg.carbon).unwrap_or_else(|e| {
        log::error!("Invalid carbon provider configuration: {e:#}");
        std::process::exit(1);
    });
    log::info!(
        "Carbon provider: {} (max signal age {}s).",
        carbon_service.provider_name(),
        carbon_service.policy().max_age_seconds()
    );

    log::info!("Starting proxy server...");
    proxy::start_proxy(Arc::new(cfg), carbon_service).await;

    log::info!("Proxy server shut down.");
}
