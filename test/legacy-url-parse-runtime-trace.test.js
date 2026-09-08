import test from 'node:test';
import assert from 'node:assert/strict';
import { traceGoogleapisCommonDiscoveryDep0169 } from '../lib/legacy-url-parse-runtime-trace.js';

test('controlled local discovery call emits DEP0169 from the statically identified dependency call-site', async () => {
  const report = await traceGoogleapisCommonDiscoveryDep0169({ rootDir: process.cwd() });

  assert.equal(report.triggerMode, 'missing-local-file');
  assert.equal(report.operationErrorCode, 'ENOENT');
  assert.equal(report.warningCode, 'DEP0169');
  assert.equal(report.traceContainsStaticMatch, true);
  assert.equal(report.staticMatch?.packageName, 'googleapis-common');
  assert.match(report.staticMatch?.path || '', /googleapis-common\/build\/src\/discovery\.js$/);
  assert.ok(Number.isInteger(report.staticMatch?.line));
});
