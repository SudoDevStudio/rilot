// Runs the Vercel adapter on a plain Node server.
//
// `vercel dev` needs a linked project and a login; this does not, so the
// adapter can be curled the way the native proxy and the Worker can. The
// TypeScript is bundled first — the same thing Vercel's build does — because
// Node cannot resolve this repo's extensionless imports on its own.
//
// On Vercel the entry point is api/rilot.ts, not this file.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const port = Number(process.env.PORT ?? 8788);

const outfile = join(mkdtempSync(join(tmpdir(), 'rilot-vercel-')), 'adapter.mjs');
await build({
  entryPoints: [join(here, 'bundle-entry.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile,
  logLevel: 'warning'
});

const { createHandler, loadEngine } = await import(pathToFileURL(outfile).href);
const wasm = readFileSync(join(repoRoot, 'target/wasm32-unknown-unknown/wasm/rilot_wasm.wasm'));
const handler = createHandler({ engine: await loadEngine(wasm) });

const server = createServer(async (req, res) => {
  const url = `http://${req.headers.host ?? `127.0.0.1:${port}`}${req.url ?? '/'}`;
  const headers = Object.entries(req.headers).flatMap(([key, value]) =>
    value === undefined ? [] : [[key, Array.isArray(value) ? value.join(', ') : value]]
  );
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const body = hasBody ? Buffer.concat(await collect(req)) : undefined;

  try {
    const response = await handler(new Request(url, { method: req.method, headers, ...(body ? { body } : {}) }));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: String(error) }, null, 2));
  }
});

async function collect(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

server.listen(port, () => {
  console.log(`Rilot (Vercel adapter) on http://127.0.0.1:${port}`);
  console.log('  /__rilot/health    /__rilot/carbon    /__rilot/decision?path=/');
});
