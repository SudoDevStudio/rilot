#!/usr/bin/env node
'use strict';

const http = require('http');

const port = Number(process.env.PORT || 3012);

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/health') {
    return sendJson(res, 200, { ok: true, service: 'plugin-oracle' });
  }

  if (url.pathname !== '/category/sample') {
    return sendJson(res, 404, { ok: false, error: 'not-found' });
  }

  // Provide deterministic, tiny override payload for Wasm plugin examples.
  return sendJson(res, 200, {
    app_url: 'http://127.0.0.1:5602',
    headers_to_update: {
      'x-plugin-energy': 'true'
    },
    energy_joules_override: 4.7,
    carbon_intensity_g_per_kwh_override: 180.0,
    energy_source: 'oracle-sim-v1'
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(JSON.stringify({ event: 'plugin_oracle_started', port }));
});
