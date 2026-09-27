use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{self, Read, Write};
use wasi_http_client::Client;
use serde_json::{json, Value};


// The world name must match interface.wit.
wit_bindgen::generate!({
    path: "interface.wit",
    world: "rilot-override",
});

#[derive(Deserialize, Serialize, Debug, Default)]
struct InternalWasmInput {
    method: String,
    path: String,
    #[serde(default)]
    headers: HashMap<String, String>,
    #[serde(default)]
    body: String,
}

#[derive(Serialize, Deserialize, Debug, Default)]
struct InternalWasmOutput {
    #[serde(skip_serializing_if = "Option::is_none")]
    app_url: Option<String>,
    #[serde(skip_serializing_if = "HashMap::is_empty", default)]
    headers_to_update: HashMap<String, String>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    headers_to_remove: Vec<String>,
    #[serde(skip_serializing_if = "HashMap::is_empty", default)]
    response_headers_to_add: HashMap<String, String>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    response_headers_to_remove: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    energy_joules_override: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    carbon_intensity_g_per_kwh_override: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    energy_source: Option<String>,
}

struct MyComponent;

impl Guest for MyComponent {
    fn modify_request() {
        let input: InternalWasmInput = read_and_parse_stdin();

        // Ask an external "oracle" what to do with this request. A real plugin
        // would call its own service here: a tenant energy meter, an internal
        // routing table, a carbon API, ... See examples/node-apps/plugin-oracle-app.js.
        let oracle_url = "http://127.0.0.1:3012/category/sample";
        let request_context = json!({
            "method": input.method,
            "path": input.path,
        });
        let api_request_body = match serde_json::to_vec(&request_context) {
            Ok(body) => body,
            Err(e) => {
                eprintln!("[plugin] could not serialize request context: {e:?}");
                write_output_and_exit(&InternalWasmOutput::default());
                return;
            }
        };

        eprintln!("[plugin] asking {oracle_url} about {} {}", input.method, input.path);
        let client = Client::new();
        let mut request_builder = client.post(oracle_url);
        // Forward the caller's headers, minus the ones the HTTP client sets itself.
        for (key, value) in &input.headers {
            let name = key.to_lowercase();
            if name != "host" && name != "content-length" {
                request_builder = request_builder.header(key, value.as_str());
            }
        }

        let resp = match request_builder.body(&api_request_body).send() {
            Ok(response) => response,
            Err(e) => {
                eprintln!("[plugin] oracle request failed: {e:?}");
                write_output_and_exit(&InternalWasmOutput::default());
                return;
            }
        };
        let body_bytes = match resp.body() {
            Ok(bytes) => bytes,
            Err(e) => {
                eprintln!("[plugin] could not read oracle response: {e:?}");
                write_output_and_exit(&InternalWasmOutput::default());
                return;
            }
        };

        let mut final_output = match serde_json::from_slice::<Value>(&body_bytes) {
            Ok(Value::Object(map)) => output_from(&map),
            Ok(_) => {
                eprintln!("[plugin] oracle response was JSON but not an object; ignoring it");
                InternalWasmOutput::default()
            }
            Err(e) => {
                eprintln!("[plugin] oracle response was not JSON: {e:?}");
                if let Ok(text) = std::str::from_utf8(&body_bytes) {
                    eprintln!("[plugin] raw body: {text}");
                }
                InternalWasmOutput::default()
            }
        };

        // Anything the plugin decides on its own can be added here too.
        final_output
            .headers_to_update
            .insert("X-Via-Rilot".to_string(), "Yes".to_string());

        eprintln!("[plugin] suggesting app_url={:?}", final_output.app_url);
        write_output_and_exit(&final_output);
    }
}


/// Maps the oracle's JSON response onto the plugin output contract.
/// See docs/wasm-carbon-plugin.md for the field meanings.
fn output_from(map: &serde_json::Map<String, Value>) -> InternalWasmOutput {
    let string_map = |key: &str| -> HashMap<String, String> {
        map.get(key)
            .and_then(Value::as_object)
            .map(|obj| {
                obj.iter()
                    .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                    .collect()
            })
            .unwrap_or_default()
    };
    let string_list = |key: &str| -> Vec<String> {
        map.get(key)
            .and_then(Value::as_array)
            .map(|arr| arr.iter().filter_map(Value::as_str).map(String::from).collect())
            .unwrap_or_default()
    };

    InternalWasmOutput {
        app_url: map.get("app_url").and_then(Value::as_str).map(String::from),
        headers_to_update: string_map("headers_to_update"),
        headers_to_remove: string_list("headers_to_remove"),
        response_headers_to_add: string_map("response_headers_to_add"),
        response_headers_to_remove: string_list("response_headers_to_remove"),
        energy_joules_override: map.get("energy_joules_override").and_then(Value::as_f64),
        carbon_intensity_g_per_kwh_override: map
            .get("carbon_intensity_g_per_kwh_override")
            .and_then(Value::as_f64),
        energy_source: map.get("energy_source").and_then(Value::as_str).map(String::from),
    }
}

fn read_and_parse_stdin() -> InternalWasmInput {
    let mut input_json_string = String::new();
    if let Err(_e) = io::stdin().read_to_string(&mut input_json_string) {
        eprintln!("[plugin] could not read stdin: {_e:?}");
        return InternalWasmInput::default();
    }
    match serde_json::from_str(&input_json_string) {
        Ok(parsed) => parsed,
        Err(e) => {
            eprintln!("[plugin] stdin was not valid JSON: {e:?}");
            InternalWasmInput::default()
        }
    }
}


fn write_output_and_exit(output: &InternalWasmOutput) {
    match serde_json::to_string_pretty(output) {
        Ok(output_json) => {
            println!("{}", output_json);
            if let Err(_e) = io::stdout().flush() {
                eprintln!("[plugin] could not flush stdout: {_e:?}");
            }
        }
        Err(_e) => {
            eprintln!("[plugin] could not serialize output: {_e:?}");
            // Valid JSON, so the host can still parse the failure.
            println!("{}", r#"{"error":"serialization failed"}"#);
            io::stdout().flush().ok(); // Flush the fallback
        }
    }
}


__export_rilot_override_impl!(MyComponent);
