#!/usr/bin/env node
"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");

const PORT = Number(process.env.CARBON_API_PORT || 18181);
const OUT_FILE = process.env.CARBON_API_OUT_FILE || path.resolve(__dirname, "../carbon-traces/electricitymap-dynamic.json");
const UPDATE_SECONDS = Math.max(1, Number(process.env.CARBON_API_UPDATE_SECONDS || 15));
const JITTER_G = Math.max(0, Number(process.env.CARBON_API_JITTER_G || 40));
const FORECAST_JITTER_G = Math.max(0, Number(process.env.CARBON_API_FORECAST_JITTER_G || 30));
const MIN_G = Math.max(0, Number(process.env.CARBON_API_MIN_G || 50));
const MAX_G = Math.max(MIN_G + 1, Number(process.env.CARBON_API_MAX_G || 900));
const BASE_ZONES = process.env.CARBON_API_BASE_ZONES || "us-east:430,us-west:300";
const SEED = Number(process.env.CARBON_API_SEED || 42);

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function parseBaseZones(raw) {
  const out = {};
  for (const part of raw.split(",")) {
    const item = part.trim();
    if (!item || !item.includes(":")) continue;
    const [name, value] = item.split(":", 2);
    const zone = name.trim();
    const base = Number(value.trim());
    if (!zone || !Number.isFinite(base)) continue;
    out[zone] = base;
  }
  if (Object.keys(out).length === 0) {
    out["us-east"] = 430;
    out["us-west"] = 300;
  }
  return out;
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return function next() {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const base = parseBaseZones(BASE_ZONES);
const state = {};
let rand = mulberry32(SEED);
let ticks = 0;
let snapshot = null;

function resetState() {
  for (const k of Object.keys(state)) {
    delete state[k];
  }
  for (const [zone, value] of Object.entries(base)) {
    state[zone] = value;
  }
  rand = mulberry32(SEED);
  ticks = 0;
}

function nextSigned(amplitude) {
  return (rand() * 2 - 1) * amplitude;
}

function buildSnapshot() {
  ticks += 1;
  const zones = {};
  for (const zone of Object.keys(state)) {
    const drift = nextSigned(JITTER_G);
    const trend = Math.sin((ticks / 8) + zone.length) * (JITTER_G * 0.35);
    const current = clamp(state[zone] + drift + trend, MIN_G, MAX_G);
    state[zone] = current;

    const forecast = clamp(
      current + nextSigned(FORECAST_JITTER_G) - (Math.sin(ticks / 10) * 8),
      MIN_G,
      MAX_G
    );

    zones[zone] = {
      carbonIntensity: Number(current.toFixed(3)),
      carbonIntensityForecast: Number(forecast.toFixed(3)),
    };
  }

  return {
    testNotes: {
      scenario: "dynamic-local-carbon-signal",
      source: "carbon-signal-api",
      tick: ticks,
      generatedAtUtc: new Date().toISOString(),
      seed: SEED,
    },
    zones,
  };
}

function writeSnapshotFile(obj) {
  const dir = path.dirname(OUT_FILE);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${OUT_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, OUT_FILE);
}

function refresh() {
  snapshot = buildSnapshot();
  writeSnapshotFile(snapshot);
}

resetState();
refresh();
const timer = setInterval(refresh, UPDATE_SECONDS * 1000);

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  if (url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, outFile: OUT_FILE, updateSeconds: UPDATE_SECONDS }) + "\n");
    return;
  }
  if (url.pathname === "/latest") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(snapshot || {}, null, 2) + "\n");
    return;
  }
  if (url.pathname === "/v3/carbon-intensity/latest") {
    const zone = (url.searchParams.get("zone") || "").trim();
    if (!zone) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "zone_required" }) + "\n");
      return;
    }
    const z = snapshot && snapshot.zones ? snapshot.zones[zone] : null;
    if (!z) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "zone_not_found", zone }) + "\n");
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        zone,
        carbonIntensity: z.carbonIntensity,
        carbonIntensityForecast: z.carbonIntensityForecast,
        datetime: new Date().toISOString(),
      }) + "\n"
    );
    return;
  }
  if (url.pathname === "/reset") {
    resetState();
    refresh();
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, reset: true, tick: ticks }) + "\n");
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not_found" }) + "\n");
});

server.listen(PORT, "0.0.0.0", () => {
  process.stdout.write(
    `carbon-signal-api listening on 0.0.0.0:${PORT}, writing ${OUT_FILE}, every ${UPDATE_SECONDS}s\n`
  );
});

function shutdown() {
  clearInterval(timer);
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
