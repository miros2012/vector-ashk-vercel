import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const health = fs.readFileSync(path.join(root, 'api', 'health.js'), 'utf8');
const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const apiFiles = fs.readdirSync(path.join(root, 'api')).filter((name) => name.endsWith('.js'));

test('cash photo surface and recovery stay multiplexed through the existing health function', () => {
  assert.match(health, /cashPhotoRoute/);
  assert.match(health, /createCashPhotoUploadService/);
  assert.match(health, /createCashPhotoRetryService/);
  assert.match(health, /createCashPhotoRetryCronHttpHandler/);
  assert.match(health, /retry-cron/);
  assert.equal(apiFiles.some((name) => name.startsWith('cash-photo-')), false);
  assert.equal(config.crons.filter((cron) => cron.path === '/api/health').length, 1);
  assert.equal(config.crons.filter((cron) => cron.path === '/api/cash-photo-retry-cron').length, 13);
  assert.equal(Object.keys(config.functions || {}).length, 5);
});

test('cash photo dispatch parses req.url and does not use Vercel req.query', () => {
  assert.match(health, /new URL\(/);
  assert.doesNotMatch(health, /req\?*\.query|req\.query|request\.query/);
});

test('cash photo async route handlers are awaited inside the shared failure guard', () => {
  assert.match(health, /return await services\.configHandler\(req, res\)/);
  assert.match(health, /return await services\.uploadHandler\(req, res\)/);
  assert.match(health, /return await services\.retryHandler\(req, res\)/);
  assert.match(health, /return await handleCashPhotoProbe\(req, res, services\)/);
});

test('cash photo cron uses a rewrite and does not add a serverless function', () => {
  const rewrite = config.rewrites.find((item) => item.source === '/api/cash-photo-retry-cron');
  assert.deepEqual(rewrite, {
    source: '/api/cash-photo-retry-cron',
    destination: '/api/health?cashPhotoRoute=retry-cron'
  });
  assert.equal(apiFiles.includes('cash-photo-retry-cron.js'), false);
});

test('failed one-time Drive API enable path stays removed from production routing', () => {
  assert.doesNotMatch(health, /enable-drive|CASH_PHOTO_ENABLE_DRIVE_NONCE|enableCashPhotoDriveApi/);
});
