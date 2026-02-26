#!/usr/bin/env node
'use strict';

const { createZoneServer } = require('./lib/create-zone-app');

createZoneServer({
  zone: process.env.ZONE_NAME || 'zone-generic',
  region: process.env.REGION || 'us-east',
  port: Number(process.env.PORT || 5601),
  baseDelayMs: Number(process.env.BASE_DELAY_MS || 25),
  jitterMs: Number(process.env.JITTER_MS || 8),
  errorRate: Number(process.env.ERROR_RATE || 0.01),
  energyPerRequestJ: Number(process.env.ENERGY_PER_REQUEST_J || 8.0),
  cpuBurnMs: Number(process.env.CPU_BURN_MS || 0),
});
