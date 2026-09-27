// Runs every shared decision fixture through the compiled rilot-core Wasm module.
// Usage: node scripts/check-wasm-fixtures.mjs [path/to/rilot_wasm.wasm]
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wasmPath =
  process.argv[2] ?? join(root, 'target/wasm32-unknown-unknown/wasm/rilot_wasm.wasm');
const bytes = readFileSync(wasmPath);

const module = await WebAssembly.compile(bytes);
const imports = WebAssembly.Module.imports(module);
if (imports.length > 0) {
  console.error('rilot-core Wasm must be self-contained, but it imports:', imports);
  process.exit(1);
}
const { exports } = await WebAssembly.instantiate(module, {});

function call(fn, input) {
  const data = new TextEncoder().encode(JSON.stringify(input));
  const ptr = exports.rilot_alloc(data.length);
  new Uint8Array(exports.memory.buffer, ptr, data.length).set(data);
  const packed = BigInt.asUintN(64, exports[fn](ptr, data.length));
  const outPtr = Number(packed >> 32n);
  const outLen = Number(packed & 0xffffffffn);
  const text = new TextDecoder().decode(new Uint8Array(exports.memory.buffer, outPtr, outLen));
  exports.rilot_dealloc(outPtr, outLen);
  return JSON.parse(text);
}

function rejections(output) {
  return Object.fromEntries(output.candidates.map((c) => [c.backend_id, c.rejections.map((r) => r.kind)]));
}

function isSubset(want, got) {
  if (want && typeof want === 'object' && !Array.isArray(want)) {
    return got && typeof got === 'object' && Object.entries(want).every(([k, v]) => isSubset(v, got[k]));
  }
  if (Array.isArray(want)) {
    return Array.isArray(got) && want.length === got.length && want.every((v, i) => isSubset(v, got[i]));
  }
  return want === got;
}

const dir = join(root, 'fixtures/decisions');
let failures = 0;
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
for (const file of files) {
  const fixture = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  const envelope = call('rilot_compute_decision', fixture.input);
  if (!envelope.ok) {
    console.error(`FAIL ${fixture.name}: ${envelope.error}`);
    failures++;
    continue;
  }
  const out = envelope.output;
  const problems = [];
  for (const [key, want] of Object.entries(fixture.expect)) {
    const got = key === 'reason_code' ? out.reason.code : key === 'rejections' ? rejections(out) : out[key];
    const ok = key === 'rejections' ? JSON.stringify(want) === JSON.stringify(got) : isSubset(want, got);
    if (!ok) problems.push(`${key}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
  if (problems.length) {
    failures++;
    console.error(`FAIL ${fixture.name}\n  ${problems.join('\n  ')}`);
  } else {
    console.log(`ok   ${fixture.name}`);
  }
}
console.log(`\n${files.length - failures}/${files.length} fixtures passed in Wasm (${bytes.length} bytes, 0 imports)`);
process.exit(failures ? 1 : 0);
