#!/usr/bin/env node
'use strict';

const { createZoneServer } = require('./lib/create-zone-app');

createZoneServer({
  zone: 'us-east',
  region: 'us-east',
  port: Number(process.env.PORT || 5601),
  baseDelayMs: Number(process.env.BASE_DELAY_MS || 18),
  jitterMs: Number(process.env.JITTER_MS || 8),
  errorRate: Number(process.env.ERROR_RATE || 0.01),
  energyPerRequestJ: Number(process.env.ENERGY_PER_REQUEST_J || 7.2),
});
