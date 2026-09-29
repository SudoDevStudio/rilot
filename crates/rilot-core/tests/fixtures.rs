use rilot_core::fixture::Fixture;
use std::path::PathBuf;

fn fixture_files() -> Vec<PathBuf> {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/decisions");
    let mut files: Vec<PathBuf> = std::fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("read {}: {e}", dir.display()))
        .map(|entry| entry.expect("dir entry").path())
        .filter(|p| p.extension().is_some_and(|e| e == "json"))
        .collect();
    files.sort();
    assert!(!files.is_empty(), "no fixtures found in {}", dir.display());
    files
}

#[test]
fn shared_decision_fixtures() {
    let mut failures = Vec::new();
    for path in fixture_files() {
        let fixture = Fixture::parse(&std::fs::read_to_string(&path).expect("read fixture"))
            .unwrap_or_else(|e| panic!("{}: {e}", path.display()));
        fixture
            .input
            .config
            .validate()
            .unwrap_or_else(|e| panic!("{}: invalid config {e:?}", fixture.name));
        let output = rilot_core::decide(&fixture.input.config, &fixture.input.context);
        if let Err(e) = fixture.check(&output) {
            failures.push(e);
        }
    }
    assert!(failures.is_empty(), "\n{}", failures.join("\n\n"));
}

#[test]
fn json_interface_matches_direct_call() {
    for path in fixture_files() {
        let raw = std::fs::read_to_string(&path).expect("read fixture");
        let fixture = Fixture::parse(&raw).expect("fixture");
        let input = serde_json::to_string(&fixture.input).expect("serialize input");
        let envelope: serde_json::Value =
            serde_json::from_str(&rilot_core::compute_decision_json(&input)).expect("envelope");
        assert_eq!(
            envelope["ok"], true,
            "{}: {}",
            fixture.name, envelope["error"]
        );
        let direct = rilot_core::decide(&fixture.input.config, &fixture.input.context);
        assert_eq!(
            envelope["output"],
            serde_json::to_value(&direct).unwrap(),
            "{}",
            fixture.name
        );
    }
}

#[test]
fn plan_requests_carbon_only_for_eligible_regions() {
    let raw = std::fs::read_to_string(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures/decisions/balanced-selection.json"),
    )
    .unwrap();
    let f = Fixture::parse(&raw).unwrap();
    let plan = rilot_core::plan(
        &f.input.config,
        &f.input.context.request,
        &Default::default(),
    );
    assert!(plan.needs_carbon);
    assert_eq!(plan.carbon_regions, vec!["us-east-1", "us-west-2"]);

    let raw = std::fs::read_to_string(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures/decisions/latency-first-selection.json"),
    )
    .unwrap();
    let f = Fixture::parse(&raw).unwrap();
    let plan = rilot_core::plan(
        &f.input.config,
        &f.input.context.request,
        &Default::default(),
    );
    assert!(!plan.needs_carbon);
    assert!(plan.carbon_regions.is_empty());
}
