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

test('cash photo surface is multiplexed through existing health function without adding Hobby functions or crons', () => {
  assert.match(health, /cashPhotoRoute/);
  assert.match(health, /createCashPhotoUploadService/);
  assert.match(health, /createCashPhotoRetryService/);
  assert.equal(apiFiles.some((name) => name.startsWith('cash-photo-')), false);
  assert.equal(config.crons.length, 14);
  assert.equal(Object.keys(config.functions || {}).length, 5);
});

test('cash photo dispatch parses req.url and does not use Vercel req.query', () => {
  assert.match(health, /new URL\(/);
  assert.doesNotMatch(health, /req\?*\.query|req\.query|request\.query/);
});
