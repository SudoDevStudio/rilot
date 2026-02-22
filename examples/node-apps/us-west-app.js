#!/usr/bin/env node
'use strict';

const { createZoneServer } = require('./lib/create-zone-app');

createZoneServer({
  zone: 'us-west',
  region: 'us-west',
  port: Number(process.env.PORT || 5602),
  baseDelayMs: Number(process.env.BASE_DELAY_MS || 32),
  jitterMs: Number(process.env.JITTER_MS || 12),
  errorRate: Number(process.env.ERROR_RATE || 0.02),
  energyPerRequestJ: Number(process.env.ENERGY_PER_REQUEST_J || 8.4),
});
