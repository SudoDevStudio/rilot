#!/usr/bin/env node
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = Number(process.env.CARBON_API_PORT || 18181);
const OUT_FILE = (process.env.CARBON_API_OUT_FILE || "").trim();
const SOURCE_CSV = (process.env.CARBON_API_SOURCE_CSV || "").trim();
const ZONE_ALIASES = process.env.CARBON_API_ZONE_ALIASES || "";

if (!SOURCE_CSV) {
  process.stderr.write(
    "Missing CARBON_API_SOURCE_CSV. This server is CSV-only and requires a source CSV file.\n"
  );
  process.exit(1);
}
if (!fs.existsSync(SOURCE_CSV) || !fs.statSync(SOURCE_CSV).isFile()) {
  process.stderr.write(`Missing CARBON_API_SOURCE_CSV file: ${SOURCE_CSV}\n`);
  process.exit(1);
}

function parseZoneAliases(raw) {
  const out = {};
  for (const part of raw.split(",")) {
    const item = part.trim();
    if (!item || !item.includes(":")) continue;
    const [externalZone, internalZone] = item.split(":", 2);
    const ext = externalZone.trim();
    const internal = internalZone.trim();
    if (!ext || !internal) continue;
    out[ext] = internal;
  }
  return out;
}

function csvToRows(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }
    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && next === "\n") {
        i += 1;
      }
      row.push(cell);
      const isEmpty = row.length === 1 && row[0] === "";
      if (!isEmpty) {
        rows.push(row);
      }
      row = [];
      cell = "";
      continue;
    }
    cell += ch;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function parseCsvObjects(text) {
  const rows = csvToRows(text);
  if (!rows.length) {
    return [];
  }
  const headers = rows[0];
  return rows.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = r[idx] ?? "";
    });
    return obj;
  });
}

function parseFiniteNumber(raw) {
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function buildSnapshotFromCsv(csvPath) {
  const raw = fs.readFileSync(csvPath, "utf8");
  const rows = parseCsvObjects(raw);
  const zones = {};
  let rowCount = 0;
  for (const row of rows) {
    const zone = String(row.zone || "").trim();
    const current = parseFiniteNumber(row.carbonIntensity);
    if (!zone || current == null) {
      continue;
    }
    const forecastRaw = parseFiniteNumber(row.carbonIntensityForecast);
    const forecast = forecastRaw == null ? current : forecastRaw;
    const datetimeRaw = String(row.datetime || "").trim();
    zones[zone] = {
      carbonIntensity: Number(current.toFixed(3)),
      carbonIntensityForecast: Number(forecast.toFixed(3)),
      datetime: datetimeRaw || null,
    };
    rowCount += 1;
  }
  if (!Object.keys(zones).length) {
    throw new Error(`No valid zone rows found in CSV: ${csvPath}`);
  }
  return {
    testNotes: {
      scenario: "static-csv-carbon-signal",
      source: "carbon-signal-api",
      generatedAtUtc: new Date().toISOString(),
      sourceCsv: csvPath,
      rowCount,
    },
    zones,
  };
}

function writeSnapshotFile(obj) {
  if (!OUT_FILE) {
    return;
  }
  const dir = path.dirname(OUT_FILE);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${OUT_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, OUT_FILE);
}

const aliases = parseZoneAliases(ZONE_ALIASES);
let snapshot = null;
const mode = "static-csv";

function refresh() {
  snapshot = buildSnapshotFromCsv(SOURCE_CSV);
  writeSnapshotFile(snapshot);
}

refresh();

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  if (url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        outFile: OUT_FILE || null,
        mode,
        sourceCsv: SOURCE_CSV,
        aliasCount: Object.keys(aliases).length,
      }) + "\n"
    );
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
    const mappedZone = aliases[zone] || "";
    const direct = snapshot && snapshot.zones ? snapshot.zones[zone] : null;
    const aliased = mappedZone && snapshot && snapshot.zones ? snapshot.zones[mappedZone] : null;
    const z = direct || aliased;
    if (!z) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "zone_not_found", zone, mappedZone }) + "\n");
      return;
    }
    const body = {
      zone,
      carbonIntensity: z.carbonIntensity,
      carbonIntensityForecast: z.carbonIntensityForecast,
      datetime: z.datetime || new Date().toISOString(),
    };
    if (!direct && aliased && mappedZone && mappedZone !== zone) {
      body.mappedZone = mappedZone;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(body) + "\n");
    return;
  }

  if (url.pathname === "/reset") {
    refresh();
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, reset: true, mode }) + "\n");
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not_found" }) + "\n");
});

server.listen(PORT, "0.0.0.0", () => {
  const outMode = OUT_FILE ? `writing ${OUT_FILE}` : "in-memory mode (no snapshot file)";
  process.stdout.write(
    `carbon-signal-api listening on 0.0.0.0:${PORT}, ${outMode}, mode=static-csv, source=${SOURCE_CSV}\n`
  );
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
