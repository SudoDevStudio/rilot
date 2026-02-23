#!/usr/bin/env node
'use strict';

const { createZoneServer } = require('./lib/create-zone-app');

createZoneServer({
  zone: 'checkout-local',
  region: 'us-east',
  port: Number(process.env.PORT || 5603),
  baseDelayMs: Number(process.env.BASE_DELAY_MS || 10),
  jitterMs: Number(process.env.JITTER_MS || 3),
  errorRate: Number(process.env.ERROR_RATE || 0.0),
  energyPerRequestJ: Number(process.env.ENERGY_PER_REQUEST_J || 6.4),
});
