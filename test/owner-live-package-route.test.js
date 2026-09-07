import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

function decisionEventSource() {
  return fs.readFileSync(path.join(root, 'api', 'decision-event.js'), 'utf8');
}

function ownerPackageHandlerBlock(source) {
  const start = source.indexOf('function createOwnerPackageHandler');
  assert.notEqual(start, -1, 'createOwnerPackageHandler must exist');
  const boundaries = [
    source.indexOf('\nfunction ', start + 1),
    source.indexOf('\nexport default', start + 1)
  ].filter(index => index !== -1);
  const end = boundaries.length ? Math.min(...boundaries) : source.length;
  return source.slice(start, end);
}

test('wires owner package through the existing decision-event function with readonly Sheets', () => {
  const source = decisionEventSource();
  assert.match(source, /createOwnerReadonlyApi/);
  assert.match(source, /createOwnerLiveSourceReader/);
  assert.match(source, /buildOwnerLivePackage/);
  assert.match(source, /ownerRoute\s*===\s*['"]package['"]/);

  const block = ownerPackageHandlerBlock(source);
  assert.match(block, /sheetsClient\(true\)/);
  assert.match(block, /createOwnerLiveSourceReader/);
  assert.match(block, /createOwnerReadonlyApi/);
  assert.match(block, /buildOwnerLivePackage/);
  assert.match(block, /generatedAt:\s*new Date\(\)\.toISOString\(\)/);
  assert.match(block, /verificationSlaHours:\s*24/);
  assert.doesNotMatch(block, /operatingReserve\s*:/);
  assert.doesNotMatch(block, /sheetsClient\(\s*\)/);
  assert.doesNotMatch(block, /\.append\(|\.update\(|\.batchUpdate\(|\.clear\(/);
});

test('adds the exact friendly rewrite without creating a new serverless function or cron', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  assert.ok(config.rewrites.some(item =>
    item.source === '/api/owner-package'
    && item.destination === '/api/decision-event?ownerRoute=package'
  ));
  assert.equal(fs.existsSync(path.join(root, 'api', 'owner-package.js')), false);
  assert.equal(config.crons.some(item => item.path === '/api/owner-package'), false);
});

test('keeps the package path on the existing protected GET-only no-store API contract', () => {
  const source = fs.readFileSync(path.join(root, 'lib', 'owner-readonly-api.js'), 'utf8');
  assert.match(source, /Cache-Control['"],\s*['"]no-store/);
  assert.match(source, /req\?\.method\s*!==\s*['"]GET['"]/);
  assert.match(source, /x-vector-key/);
  assert.match(source, /Bearer\\s\+/);
  assert.match(source, /status\(403\)/);
  assert.match(source, /status\(200\)\.json\(\{\s*ok:\s*true,\s*package:/);
});
