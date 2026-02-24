'use strict';

const http = require('http');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomInt(max) {
  return Math.floor(Math.random() * max);
}

function createZoneServer(opts) {
  const zone = opts.zone;
  const region = opts.region;
  const port = opts.port;
  const baseDelayMs = opts.baseDelayMs;
  const jitterMs = opts.jitterMs;
  const errorRate = opts.errorRate;
  const energyPerRequestJ = opts.energyPerRequestJ;

  function sendJson(res, status, body) {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(payload),
      'x-zone': zone,
      'x-region': region,
    });
    res.end(payload);
  }

  const server = http.createServer(async (req, res) => {
    const start = Date.now();
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const delay = baseDelayMs + (jitterMs > 0 ? randomInt(jitterMs + 1) : 0);
    if (delay > 0) {
      await sleep(delay);
    }

    if (url.pathname === '/health') {
      return sendJson(res, 200, { ok: true, zone, region });
    }

    if (url.pathname === '/energy-model') {
      return sendJson(res, 200, {
        zone,
        region,
        energy_joules_override: energyPerRequestJ,
        energy_source: `${zone}-sim-energy-v1`,
      });
    }

    if (Math.random() < errorRate || url.pathname === '/unstable') {
      return sendJson(res, 503, {
        ok: false,
        zone,
        region,
        error: 'simulated-backend-failure',
      });
    }

    const now = new Date().toISOString();
    const elapsed = Date.now() - start;
    return sendJson(res, 200, {
      ok: true,
      zone,
      region,
      method: req.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams.entries()),
      simulated_delay_ms: delay,
      observed_handler_ms: elapsed,
      energy_joules_hint: energyPerRequestJ,
      timestamp_utc: now,
      headers: req.headers,
    });
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(
      JSON.stringify({
        event: 'zone_server_started',
        zone,
        region,
        port,
        base_delay_ms: baseDelayMs,
        jitter_ms: jitterMs,
        error_rate: errorRate,
        energy_per_request_j: energyPerRequestJ,
      })
    );
  });

  return server;
}

module.exports = { createZoneServer };
