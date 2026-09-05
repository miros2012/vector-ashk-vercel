import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../api/health.js', import.meta.url), 'utf8');

test('health route records only an authorized Tochka operation refresh heartbeat', () => {
  assert.match(source, /writeControlMarker/);
  assert.match(source, /tochka_operations_last_success_utc/);
  assert.match(source, /tochka_operations_heartbeat_key_sha256/);
  assert.match(source, /operations_refresh_success/);
  assert.match(source, /createHash\('sha256'\)/);
  assert.match(source, /timingSafeEqual/);
  assert.match(source, /\['x-vector-key'\]/);
  assert.match(source, /\['x-vector-refresh'\]/);
  assert.match(source, /CONTROL_SHEET = '__vercel_control'/);
  assert.match(source, /range: `\'\$\{CONTROL_SHEET\}\'!A:B`/);

  const handlerAt = source.indexOf('async function handleTochkaOperationsRefreshSuccess');
  const sheetsAt = source.indexOf('const sheets = await getSheets()', handlerAt);
  const authAt = source.indexOf('await isAuthorizedTochkaBridge(req, sheets)', handlerAt);
  const markerAt = source.indexOf('writeControlMarker({', handlerAt);
  const successAt = source.indexOf("mode: 'operations_refresh_recorded'", handlerAt);

  assert.ok(handlerAt >= 0, 'heartbeat handler must exist');
  assert.ok(sheetsAt > handlerAt, 'heartbeat handler must obtain the Sheets client');
  assert.ok(authAt > sheetsAt, 'authorization must run before marker write');
  assert.ok(markerAt > authAt, 'marker write must happen only after authorization');
  assert.ok(successAt > markerAt, 'success must be returned only after marker write');
});
