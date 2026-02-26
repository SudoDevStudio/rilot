#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

function parseArgs(argv) {
  const args = {
    inputDir: "",
    resultsBase: "",
    outFile: "charts.html",
  };
  for (let i = 2; i < argv.length; i += 1) {
    const v = argv[i];
    if ((v === "--input-dir" || v === "-i") && argv[i + 1]) {
      args.inputDir = argv[i + 1];
      i += 1;
      continue;
    }
    if ((v === "--results-base" || v === "-b") && argv[i + 1]) {
      args.resultsBase = argv[i + 1];
      i += 1;
      continue;
    }
    if ((v === "--out" || v === "-o") && argv[i + 1]) {
      args.outFile = argv[i + 1];
      i += 1;
    }
  }
  return args;
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

function readCsv(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const rows = csvToRows(raw);
  if (rows.length === 0) {
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

function parseNumber(v) {
  if (v === "" || v == null) {
    return null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function latestComparativeDir(baseDir) {
  const entries = fs
    .readdirSync(baseDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith("comparative-"))
    .map((d) => ({
      name: d.name,
      full: path.join(baseDir, d.name),
      mtime: fs.statSync(path.join(baseDir, d.name)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);
  if (entries.length === 0) {
    throw new Error(`No comparative-* folder found in ${baseDir}`);
  }
  return entries[0].full;
}

function defaultResultsBase() {
  const root = path.resolve(__dirname, "..");
  const live = path.join(root, "result_live");
  const normal = path.join(root, "results");
  if (fs.existsSync(live) && fs.readdirSync(live).some((n) => n.startsWith("comparative-"))) {
    return live;
  }
  return normal;
}

function buildHtml(payload) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Rilot Experiment Charts</title>
  <script src="https://cdn.jsdelivr.net/npm/d3@7"></script>
  <style>
    :root {
      --bg: #f7f4ee;
      --ink: #12202a;
      --muted: #4d5b65;
      --card: #ffffff;
      --accent: #1f7a8c;
      --accent2: #bf4342;
      --grid: #dde4e8;
    }
    body {
      margin: 0;
      font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
      background: radial-gradient(circle at top left, #fefbf4, var(--bg));
      color: var(--ink);
    }
    .wrap {
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
    }
    .top {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 14px;
    }
    .badge {
      background: var(--card);
      border: 1px solid #d4dde3;
      border-radius: 8px;
      padding: 8px 10px;
      font-size: 13px;
      color: var(--muted);
    }
    h1 {
      margin: 0 0 10px;
      font-size: 24px;
    }
    .grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 14px;
    }
    .card {
      background: var(--card);
      border: 1px solid #d4dde3;
      border-radius: 12px;
      padding: 14px 16px;
    }
    .card h3 {
      margin: 2px 0 10px;
      font-size: 18px;
    }
    svg {
      width: 100%;
      height: 360px;
      display: block;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    th, td {
      padding: 6px 7px;
      border-bottom: 1px solid #e5ecef;
      text-align: left;
    }
    th {
      color: var(--muted);
      font-weight: 600;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>Rilot Comparative Dashboard</h1>
    <div class="top">
      <div class="badge">Input: <code>${payload.inputDir}</code></div>
      <div class="badge">Generated: ${new Date().toISOString()}</div>
      <div class="badge">Scenarios: ${payload.summary.length}</div>
      <div class="badge">Requests: ${payload.requests.length}</div>
    </div>

    <div class="grid">
      <div class="card"><h3>Mean Carbon Exposure (gCO2/kWh)</h3><svg id="carbon"></svg></div>
      <div class="card"><h3>P95 Latency (ms)</h3><svg id="latency"></svg></div>
      <div class="card"><h3>Cross-Region Reroutes</h3><svg id="reroutes"></svg></div>
      <div class="card"><h3>Selected Zone Region Mix</h3><svg id="zones"></svg></div>
    </div>

    <div class="card" style="margin-top:14px;">
      <h3>Scenario Table</h3>
      <table id="summaryTable"></table>
    </div>
  </div>

  <script>
    const summary = ${JSON.stringify(payload.summary)};
    const requests = ${JSON.stringify(payload.requests)};

    function drawBar(opts) {
      const { id, data, key, color, yLabel } = opts;
      const svg = d3.select(id);
      svg.selectAll("*").remove();
      const w = svg.node().clientWidth || 500;
      const h = svg.node().clientHeight || 300;
      const m = { t: 26, r: 20, b: 110, l: 64 };
      const iw = w - m.l - m.r;
      const ih = h - m.t - m.b;
      const g = svg.append("g").attr("transform", "translate(" + m.l + "," + m.t + ")");

      const x = d3.scaleBand()
        .domain(data.map(d => d.scenario))
        .range([0, iw])
        .padding(0.2);
      const maxY = d3.max(data, d => Number(d[key]) || 0) || 1;
      const y = d3.scaleLinear().domain([0, maxY]).nice().range([ih, 0]);

      g.append("g")
        .attr("transform", "translate(0," + ih + ")")
        .call(d3.axisBottom(x))
        .selectAll("text")
        .attr("transform", "rotate(-22)")
        .style("text-anchor", "end");

      g.append("g").call(d3.axisLeft(y));
      g.append("g")
        .attr("transform", "translate(-48," + (ih / 2) + ") rotate(-90)")
        .append("text")
        .style("fill", "#4d5b65")
        .style("font-size", "13px")
        .text(yLabel);

      const bars = g.selectAll("rect")
        .data(data)
        .enter()
        .append("rect")
        .attr("x", d => x(d.scenario))
        .attr("y", d => y(Number(d[key]) || 0))
        .attr("width", x.bandwidth())
        .attr("height", d => ih - y(Number(d[key]) || 0))
        .attr("fill", color);

      g.selectAll(".bar-label")
        .data(data)
        .enter()
        .append("text")
        .attr("class", "bar-label")
        .attr("x", d => (x(d.scenario) || 0) + x.bandwidth() / 2)
        .attr("y", d => y(Number(d[key]) || 0) - 6)
        .attr("text-anchor", "middle")
        .style("font-size", "11px")
        .style("fill", "#21323e")
        .text(d => {
          const v = Number(d[key]) || 0;
          if (Math.abs(v) >= 100) return v.toFixed(0);
          if (Math.abs(v) >= 10) return v.toFixed(1);
          return v.toFixed(2);
        });
    }

    function drawZones() {
      const svg = d3.select("#zones");
      svg.selectAll("*").remove();
      const w = svg.node().clientWidth || 500;
      const h = svg.node().clientHeight || 300;
      const m = { t: 24, r: 20, b: 52, l: 64 };
      const iw = w - m.l - m.r;
      const ih = h - m.t - m.b;
      const g = svg.append("g").attr("transform", "translate(" + m.l + "," + m.t + ")");

      const counts = d3.rollup(
        requests.filter(r => r.selected_zone_region),
        v => v.length,
        d => d.selected_zone_region
      );
      const data = Array.from(counts, ([region, count]) => ({ region, count }))
        .sort((a, b) => d3.descending(a.count, b.count));
      const x = d3.scaleBand().domain(data.map(d => d.region)).range([0, iw]).padding(0.25);
      const y = d3.scaleLinear().domain([0, d3.max(data, d => d.count) || 1]).nice().range([ih, 0]);
      g.append("g").attr("transform", "translate(0," + ih + ")").call(d3.axisBottom(x));
      g.append("g").call(d3.axisLeft(y));
      g.selectAll("rect").data(data).enter().append("rect")
        .attr("x", d => x(d.region)).attr("y", d => y(d.count))
        .attr("width", x.bandwidth()).attr("height", d => ih - y(d.count))
        .attr("fill", "#355070");

      g.selectAll(".zone-label")
        .data(data)
        .enter()
        .append("text")
        .attr("class", "zone-label")
        .attr("x", d => (x(d.region) || 0) + x.bandwidth() / 2)
        .attr("y", d => y(d.count) - 6)
        .attr("text-anchor", "middle")
        .style("font-size", "11px")
        .style("fill", "#21323e")
        .text(d => d.count);
    }

    function renderTable() {
      const cols = [
        "scenario",
        "requests",
        "error_rate_percent",
        "latency_p95_ms",
        "cross_region_reroutes",
        "carbon_exposure_mean_g_per_kwh",
        "carbon_exposure_saved_percent_vs_baseline"
      ];
      const t = d3.select("#summaryTable");
      const thead = t.append("thead").append("tr");
      cols.forEach(c => thead.append("th").text(c));
      const tbody = t.append("tbody");
      summary.forEach(row => {
        const tr = tbody.append("tr");
        cols.forEach(c => tr.append("td").text(row[c] ?? ""));
      });
    }

    drawBar({
      id: "#carbon",
      data: summary,
      key: "carbon_exposure_mean_g_per_kwh",
      color: "#1f7a8c",
      yLabel: "gCO2/kWh"
    });
    drawBar({
      id: "#latency",
      data: summary,
      key: "latency_p95_ms",
      color: "#6d597a",
      yLabel: "ms"
    });
    drawBar({
      id: "#reroutes",
      data: summary,
      key: "cross_region_reroutes",
      color: "#bf4342",
      yLabel: "count"
    });
    drawZones();
    renderTable();
  </script>
</body>
</html>`;
}

function main() {
  try {
    const args = parseArgs(process.argv);
    const resultsBase = args.resultsBase
      ? path.resolve(args.resultsBase)
      : defaultResultsBase();
    const inputDir = args.inputDir
      ? path.resolve(args.inputDir)
      : latestComparativeDir(resultsBase);
    const summaryPath = path.join(inputDir, "summary.csv");
    const requestsPath = path.join(inputDir, "requests.csv");

    if (!fs.existsSync(summaryPath)) {
      throw new Error(`Missing file: ${summaryPath}`);
    }
    if (!fs.existsSync(requestsPath)) {
      throw new Error(`Missing file: ${requestsPath}`);
    }

    const summary = readCsv(summaryPath).map((r) => ({
      ...r,
      requests: parseNumber(r.requests),
      error_rate_percent: parseNumber(r.error_rate_percent),
      latency_p95_ms: parseNumber(r.latency_p95_ms),
      cross_region_reroutes: parseNumber(r.cross_region_reroutes),
      carbon_exposure_mean_g_per_kwh: parseNumber(r.carbon_exposure_mean_g_per_kwh),
      carbon_exposure_saved_percent_vs_baseline: parseNumber(
        r.carbon_exposure_saved_percent_vs_baseline
      ),
    }));
    const requests = readCsv(requestsPath);

    const html = buildHtml({
      inputDir,
      summary,
      requests,
    });
    const outPath = path.isAbsolute(args.outFile)
      ? args.outFile
      : path.join(inputDir, args.outFile);
    fs.writeFileSync(outPath, html, "utf8");
    console.log(`Chart dashboard written: ${outPath}`);
    return 0;
  } catch (e) {
    console.error(e.message || String(e));
    return 1;
  }
}

process.exit(main());
