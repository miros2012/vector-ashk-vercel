import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const routeSource = fs.readFileSync(path.join(here, '..', 'api', 'nightly-finance-orchestrator.js'), 'utf8');
const config = JSON.parse(fs.readFileSync(path.join(here, '..', 'vercel.json'), 'utf8'));

test('existing finance route wires protected current-day Tochka DDS import into both flows', () => {
  assert.match(routeSource, /tochka-dds-import\.js/);
  assert.match(routeSource, /syncCurrentDayTochkaDds/);
  assert.match(routeSource, /createTochkaDdsImportHandler/);
  assert.match(routeSource, /runTochkaDdsNow/);
  assert.equal((routeSource.match(/runTochkaDds:\s*tochkaDdsHandler/g) || []).length, 2);

  const dateAt = routeSource.indexOf('tyumenToday()');
  const importAt = routeSource.indexOf('syncCurrentDayTochkaDds');
  assert.ok(dateAt >= 0 && importAt >= 0);
});

test('current-day DDS import adds no API route, function or cron', () => {
  assert.equal(Object.keys(config.functions || {}).length, 5);
  assert.equal(config.crons.length, 14);
  assert.ok(!Object.keys(config.functions || {}).some(file => file.includes('tochka-dds')));
});
