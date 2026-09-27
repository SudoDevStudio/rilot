//! Wasm bindings for rilot-core.
//!
//! A deliberately tiny C ABI so the browser can load the module with plain
//! `WebAssembly.instantiate` (no wasm-bindgen, no JS glue generation):
//!
//! 1. `rilot_alloc(len)` → pointer; the host writes UTF-8 JSON input there.
//! 2. `rilot_compute_decision(ptr, len)` (or `rilot_plan` / `rilot_resolve_config`)
//!    consumes the input buffer and returns `(out_ptr << 32) | out_len`.
//! 3. The host reads the UTF-8 JSON envelope and calls `rilot_dealloc(out_ptr, out_len)`.
//!
//! No routing logic lives here — only marshalling.

/// Allocates `len` bytes for the host to write input into.
#[no_mangle]
pub extern "C" fn rilot_alloc(len: usize) -> *mut u8 {
    let mut buf = Vec::<u8>::with_capacity(len);
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr
}

/// Frees a buffer previously returned by `rilot_alloc` or an output buffer.
///
/// # Safety
/// `ptr`/`len` must come from `rilot_alloc(len)` or a packed output of this module.
#[no_mangle]
pub unsafe extern "C" fn rilot_dealloc(ptr: *mut u8, len: usize) {
    if !ptr.is_null() {
        drop(Vec::from_raw_parts(ptr, 0, len));
    }
}

/// # Safety
/// `ptr`/`len` must come from `rilot_alloc(len)`; the buffer is consumed.
#[no_mangle]
pub unsafe extern "C" fn rilot_compute_decision(ptr: *mut u8, len: usize) -> u64 {
    call(ptr, len, rilot_core::compute_decision_json)
}

/// # Safety
/// `ptr`/`len` must come from `rilot_alloc(len)`; the buffer is consumed.
#[no_mangle]
pub unsafe extern "C" fn rilot_plan(ptr: *mut u8, len: usize) -> u64 {
    call(ptr, len, rilot_core::plan_json)
}

/// # Safety
/// `ptr`/`len` must come from `rilot_alloc(len)`; the buffer is consumed.
#[no_mangle]
pub unsafe extern "C" fn rilot_resolve_config(ptr: *mut u8, len: usize) -> u64 {
    call(ptr, len, rilot_core::resolve_config_json)
}

/// Carbon cache policy: what can be served, what must be fetched.
///
/// # Safety
/// `ptr`/`len` must come from `rilot_alloc(len)`; the buffer is consumed.
#[no_mangle]
pub unsafe extern "C" fn rilot_carbon_plan(ptr: *mut u8, len: usize) -> u64 {
    call(ptr, len, rilot_carbon_policy::json::plan_json)
}

/// Carbon cache policy: combine cached and freshly fetched signals.
///
/// # Safety
/// `ptr`/`len` must come from `rilot_alloc(len)`; the buffer is consumed.
#[no_mangle]
pub unsafe extern "C" fn rilot_carbon_merge(ptr: *mut u8, len: usize) -> u64 {
    call(ptr, len, rilot_carbon_policy::json::merge_json)
}

/// Per-session policy override carried in a cookie.
///
/// # Safety
/// `ptr`/`len` must come from `rilot_alloc(len)`; the buffer is consumed.
#[no_mangle]
pub unsafe extern "C" fn rilot_cookie_policy(ptr: *mut u8, len: usize) -> u64 {
    call(ptr, len, rilot_core::json::cookie_policy_json)
}

/// Version of the linked core, as a packed output buffer.
#[no_mangle]
pub extern "C" fn rilot_version() -> u64 {
    pack(format!(
        "{{\"ok\":true,\"output\":\"{}\"}}",
        env!("CARGO_PKG_VERSION")
    ))
}

unsafe fn call(ptr: *mut u8, len: usize, f: fn(&str) -> String) -> u64 {
    let input = Vec::from_raw_parts(ptr, len, len);
    let output = match std::str::from_utf8(&input) {
        Ok(text) => f(text),
        Err(_) => r#"{"ok":false,"error":"input is not valid UTF-8"}"#.to_string(),
    };
    pack(output)
}

fn pack(output: String) -> u64 {
    let bytes = output.into_bytes().into_boxed_slice();
    let len = bytes.len();
    let ptr = Box::into_raw(bytes) as *mut u8;
    ((ptr as usize as u64) << 32) | len as u64
}
