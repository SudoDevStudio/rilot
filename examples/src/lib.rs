use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{self, Read, Write}; // Import Write trait
use wasi_http_client::Client;
use serde_json::{json, Value};


wit_bindgen::generate!({
    path: "interface.wit",     // Keep explicit path
    world: "rilot-override",  // Must match world name in interface.wit
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
        eprintln!("[Wasm/lib.rs] modify_request called. Reading stdin...");
        let input: InternalWasmInput = read_and_parse_stdin();
        let client = Client::new();
        let external_api_url = "http://127.0.0.1:3012/category/sample"; // Example API

        let custom_payload = json!({ // Example custom body
            "name": "test",
            "salary": "123",
            "age": "23"
        });
        let api_request_body = match serde_json::to_vec(&custom_payload) {
            Ok(body) => body,
            Err(_e) => { /* ... handle error ... */ write_output_and_exit(&InternalWasmOutput::default()); return; }
        };

        eprintln!("[Wasm/lib.rs] Sending request to external API: {}", external_api_url);
        let mut request_builder = client.post(external_api_url) /* ... headers ... */;
        // ... (add headers loop remains the same) ...
        // for (key, value) in &input.headers {
        //      if key.to_lowercase() != "host" && key.to_lowercase() != "content-length" {
        //           request_builder = request_builder.header(key, value.as_str());
        //      }
        // }
        let resp_result = request_builder.body(&api_request_body).send();

        let resp = match resp_result {
            Ok(r) => { /* ... */ r },
            Err(_e) => { /* ... handle error ... */ write_output_and_exit(&InternalWasmOutput::default()); return; }
        };
        let body_result = resp.body();
        let body_bytes = match body_result {
             Ok(b) => { /* ... */ b },
             Err(_e) => { /* ... */ write_output_and_exit(&InternalWasmOutput::default()); return; }
        };

        eprintln!("[Wasm/lib.rs] Attempting to parse API response body as JSON Value...");
        let mut final_output = InternalWasmOutput::default();

        match serde_json::from_slice::<Value>(&body_bytes) {
            Ok(api_response_value) => {
                eprintln!("[Wasm/lib.rs] Successfully parsed API response as JSON Value.");
                if let Value::Object(map) = api_response_value {
                    eprintln!("[Wasm/lib.rs] API response is a JSON object. Extracting fields...");

                    final_output.app_url = map.get("app_url").or_else(|| map.get("target_backend_url")).and_then(Value::as_str).map(String::from);
                    final_output.headers_to_update = map.get("headers_to_update").or_else(|| map.get("extra_request_headers")).and_then(Value::as_object).map(|obj| obj.iter().filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string()))).collect()).unwrap_or_default();
                    final_output.headers_to_remove = map.get("headers_to_remove").or_else(|| map.get("strip_request_headers")).and_then(Value::as_array).map(|arr| arr.iter().filter_map(Value::as_str).map(String::from).collect()).unwrap_or_default();
                    final_output.response_headers_to_add = map.get("response_headers_to_add").or_else(|| map.get("final_response_headers")).and_then(Value::as_object).map(|obj| obj.iter().filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string()))).collect()).unwrap_or_default();
                    final_output.response_headers_to_remove = map.get("response_headers_to_remove").or_else(|| map.get("strip_response_headers")).and_then(Value::as_array).map(|arr| arr.iter().filter_map(Value::as_str).map(String::from).collect()).unwrap_or_default();
                    final_output.energy_joules_override = map
                        .get("energy_joules_override")
                        .or_else(|| map.get("energy_joules_per_request"))
                        .and_then(Value::as_f64);
                    final_output.carbon_intensity_g_per_kwh_override = map
                        .get("carbon_intensity_g_per_kwh_override")
                        .and_then(Value::as_f64);
                    final_output.energy_source = map
                        .get("energy_source")
                        .and_then(Value::as_str)
                        .map(String::from);
                    eprintln!("[Wasm/lib.rs] Extracted data: {:?}", final_output);
                } else {
                    eprintln!("[Wasm/lib.rs] WARNING: API response was valid JSON but not an object.");
                }
            },
            Err(_e) => {
                eprintln!("[Wasm/lib.rs] ERROR: Failed to parse JSON response from external API: {:?}", _e);
                match std::str::from_utf8(&body_bytes) {
                    Ok(s) => eprintln!("[Wasm/lib.rs] Raw API response body: {}", s),
                    Err(_) => eprintln!("[Wasm/lib.rs] Raw API response body was not valid UTF-8."),
                }
            }
        };

        // Example: Manually add/override response header AFTER parsing/extracting
        final_output.headers_to_update.insert(
            "X-Via-Rilot".to_string(),
            "Yes".to_string()
        );

        eprintln!("[Wasm/lib.rs] Final app_url to suggest: {:?}", final_output.app_url);

        write_output_and_exit(&final_output);
    }
}


fn read_and_parse_stdin() -> InternalWasmInput {
    eprintln!("[Wasm/lib.rs] Reading stdin...");
    let mut input_json_string = String::new();
    if let Err(_e) = io::stdin().read_to_string(&mut input_json_string) {
        eprintln!("[Wasm/lib.rs] ERROR: Failed to read from stdin: {:?}", _e);
        return InternalWasmInput::default();
    }
    eprintln!("[Wasm/lib.rs] Read {} bytes from stdin.", input_json_string.len());
    match serde_json::from_str(&input_json_string) {
        Ok(parsed) => parsed,
        Err(e) => {
            eprintln!("[Wasm/lib.rs] ERROR: Failed to parse stdin JSON: {:?}", e);
            InternalWasmInput::default()
        }
    }
}


fn write_output_and_exit(output: &InternalWasmOutput) {
    match serde_json::to_string_pretty(output) {
        Ok(output_json) => {
            eprintln!("[Wasm/lib.rs] Writing output JSON to std::io::stdout ({} bytes)", output_json.len());
            println!("{}", output_json);
            if let Err(_e) = io::stdout().flush() {
                eprintln!("[Wasm/lib.rs] ERROR: Failed to flush std::io::stdout: {:?}", _e);
            }
        }
        Err(_e) => {
            eprintln!("[Wasm/lib.rs] ERROR: Failed to serialize final output: {:?}", _e);
            let error_json = "{{\"error\":\"serialization failed\"}}";
            println!("{}", error_json);
            io::stdout().flush().ok(); // Flush the fallback
        }
    }
    eprintln!("[Wasm/lib.rs] modify_request finished.");
}


// Use the export macro generated by wit-bindgen
// If this name is wrong, the compiler will error after wit-bindgen runs successfully.
__export_rilot_override_impl!(MyComponent);
