// Wrangler compiles imported .wasm files into WebAssembly.Module bindings.
declare module '*.wasm' {
  const module: WebAssembly.Module;
  export default module;
}
