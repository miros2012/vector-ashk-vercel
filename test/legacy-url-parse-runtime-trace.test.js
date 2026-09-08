import test from 'node:test';
import assert from 'node:assert/strict';
import { traceGoogleapisCommonDiscoveryDep0169 } from '../lib/legacy-url-parse-runtime-trace.js';

function assertDiscoveryCallExecuted(report) {
  assert.equal(report.triggerMode, 'missing-local-file');
  assert.equal(report.operationErrorCode, 'ENOENT');
  assert.equal(report.staticMatch?.packageName, 'googleapis-common');
  assert.match(report.staticMatch?.path || '', /googleapis-common\/build\/src\/discovery\.js$/);
  assert.ok(Number.isInteger(report.staticMatch?.line));
}

test('Node 24 application deprecation stays silent for the reachable dependency call-site by default', async () => {
  const report = await traceGoogleapisCommonDiscoveryDep0169({ rootDir: process.cwd() });

  assertDiscoveryCallExecuted(report);
  assert.equal(report.warningCode, null);
  assert.equal(report.traceContainsStaticMatch, false);
});

test('pending deprecation mode traces DEP0169 to the same statically identified dependency call-site', async () => {
  const report = await traceGoogleapisCommonDiscoveryDep0169({
    rootDir: process.cwd(),
    pendingDeprecation: true
  });

  assertDiscoveryCallExecuted(report);
  assert.equal(report.warningCode, 'DEP0169');
  assert.equal(report.traceContainsStaticMatch, true);
});
