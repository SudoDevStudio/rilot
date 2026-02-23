#!/usr/bin/env node
'use strict';

const { createZoneServer } = require('./lib/create-zone-app');

createZoneServer({
  zone: 'bg-west',
  region: 'us-west',
  port: Number(process.env.PORT || 5605),
  baseDelayMs: Number(process.env.BASE_DELAY_MS || 70),
  jitterMs: Number(process.env.JITTER_MS || 16),
  errorRate: Number(process.env.ERROR_RATE || 0.01),
  energyPerRequestJ: Number(process.env.ENERGY_PER_REQUEST_J || 5.0),
});
