// Compiles rilot-core to Wasm and copies it next to the Edge Function entry.
//
// Vercel bundles files imported from `api/`, and its Edge runtime loads a
// `.wasm` import as a compiled module (`?module`), so the binary has to sit
// there rather than in src/.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const built = join(repoRoot, 'target/wasm32-unknown-unknown/wasm/rilot_wasm.wasm');
const dest = join(here, '..', 'api/generated/rilot_core.wasm');

try {
  execFileSync(
    'cargo',
    ['build', '-p', 'rilot-wasm', '--profile', 'wasm', '--target', 'wasm32-unknown-unknown'],
    { cwd: repoRoot, stdio: 'inherit' }
  );
} catch {
  console.error(
    '\nFailed to build rilot-core for the edge. Install Rust and run:\n' +
      '  rustup target add wasm32-unknown-unknown\n'
  );
  process.exit(1);
}

if (!existsSync(built)) {
  console.error(`Expected ${built} after cargo build`);
  process.exit(1);
}
mkdirSync(dirname(dest), { recursive: true });
copyFileSync(built, dest);
console.log(`rilot-core.wasm → ${dest} (${statSync(dest).size} bytes)`);
