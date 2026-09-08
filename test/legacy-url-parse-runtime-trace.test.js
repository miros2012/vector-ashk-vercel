import test from 'node:test';
import assert from 'node:assert/strict';
import {
  traceApplicationUrlParseDep0169,
  traceGoogleapisCommonDiscoveryDep0169
} from '../lib/legacy-url-parse-runtime-trace.js';

function assertDiscoveryCallExecuted(report) {
  assert.equal(report.triggerMode, 'missing-local-file');
  assert.equal(report.operationErrorCode, 'ENOENT');
  assert.equal(report.staticMatch?.packageName, 'googleapis-common');
  assert.match(report.staticMatch?.path || '', /googleapis-common\/build\/src\/discovery\.js$/);
  assert.ok(Number.isInteger(report.staticMatch?.line));
}

test('controlled dependency call is reachable but does not emit DEP0169 from node_modules on Node 24', async () => {
  const report = await traceGoogleapisCommonDiscoveryDep0169({ rootDir: process.cwd() });

  assertDiscoveryCallExecuted(report);
  assert.equal(report.warningCode, null);
  assert.equal(report.traceContainsStaticMatch, false);
});

test('same trace harness observes DEP0169 for an application-level url.parse control', async () => {
  const report = await traceApplicationUrlParseDep0169({ rootDir: process.cwd() });

  assert.equal(report.triggerMode, 'application-control');
  assert.equal(report.operationErrorCode, null);
  assert.equal(report.warningCode, 'DEP0169');
  assert.equal(report.traceContainsApplicationControl, true);
});
