import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../api/health.js', import.meta.url), 'utf8');

test('health route records only an authorized Tochka operation refresh heartbeat', () => {
  assert.match(source, /writeControlMarker/);
  assert.match(source, /tochka_operations_last_success_utc/);
  assert.match(source, /operations_refresh_success/);
  assert.match(source, /TOCHKA_BRIDGE_KEY \|\| process\.env\.VECTOR_SYNC_KEY/);
  assert.match(source, /\['x-vector-key'\]/);
  assert.match(source, /\['x-vector-refresh'\]/);

  const handlerAt = source.indexOf('async function handleTochkaOperationsRefreshSuccess');
  const authAt = source.indexOf('isAuthorizedTochkaBridge(req)', handlerAt);
  const markerAt = source.indexOf('writeControlMarker({', handlerAt);
  const successAt = source.indexOf("mode: 'operations_refresh_recorded'", handlerAt);

  assert.ok(handlerAt >= 0, 'heartbeat handler must exist');
  assert.ok(authAt > handlerAt, 'authorization must run inside heartbeat handler');
  assert.ok(markerAt > authAt, 'marker write must happen only after authorization');
  assert.ok(successAt > markerAt, 'success must be returned only after marker write');
});
