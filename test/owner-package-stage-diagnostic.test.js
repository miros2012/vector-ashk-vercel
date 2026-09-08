import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createOwnerReadonlyApi } from '../lib/owner-readonly-api.js';

const EXPECTED_STAGES = Object.freeze([
  'FORECAST_READ',
  'BATCH_READ',
  'MATRICES_PARSE',
  'DATA_HEALTH_PARSE',
  'SALES_PARSE',
  'RECEIVABLES_PARSE',
  'OBLIGATIONS_PARSE',
  'DRIVING_FUND_PARSE',
  'DECISIONS_PARSE',
  'HISTORY_PARSE',
  'PACKAGE_BUILD',
  'UNCLASSIFIED'
]);

const stageModuleUrl = new URL('../lib/owner-package-stage.js', import.meta.url);

function responseRecorder() {
  const headers = new Map();
  return {
    code: 200,
    body: null,
    headers,
    setHeader(name, value) {
      headers.set(String(name).toLowerCase(), String(value));
    },
    status(code) {
      this.code = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

async function loadStageModule() {
  assert.equal(
    existsSync(stageModuleUrl),
    true,
    'Owner package stage helper must exist before stage diagnostics can pass'
  );
  return import(stageModuleUrl.href);
}

test('Owner package stage helper exposes only the fixed allowlist and strips raw errors', async () => {
  const {
    OWNER_PACKAGE_STAGES,
    runOwnerPackageStage,
    ownerPackageFailureStage
  } = await loadStageModule();

  assert.deepEqual([...OWNER_PACKAGE_STAGES], EXPECTED_STAGES);

  const rawMarker = 'RAW_FINANCE_OR_SECRET_MARKER_90413';
  const stagedError = await runOwnerPackageStage('OBLIGATIONS_PARSE', async () => {
    throw new Error(rawMarker);
  }).then(() => null, error => error);

  assert.equal(ownerPackageFailureStage(stagedError), 'OBLIGATIONS_PARSE');
  assert.equal(String(stagedError?.message || '').includes(rawMarker), false);
  assert.equal(String(stagedError?.stack || '').includes(rawMarker), false);

  const unknownStageError = await runOwnerPackageStage('DO_NOT_LOG_THIS_STAGE', async () => {
    throw new Error(rawMarker);
  }).then(() => null, error => error);
  assert.equal(ownerPackageFailureStage(unknownStageError), 'UNCLASSIFIED');
  assert.equal(ownerPackageFailureStage(new Error(rawMarker)), 'UNCLASSIFIED');
});

test('Owner readonly failure logs one allowlisted stage while keeping the response generic and no-store', async () => {
  const { runOwnerPackageStage } = await loadStageModule();
  const configuredKey = 'owner-diagnostic-key-0123456789abcdef';
  const rawMarker = 'DO_NOT_EXPOSE_OWNER_PAYLOAD_55109';
  const api = createOwnerReadonlyApi({
    configuredKey,
    readOwnerPackage: async () => runOwnerPackageStage('OBLIGATIONS_PARSE', async () => {
      throw new Error(rawMarker);
    })
  });
  const response = responseRecorder();
  const captured = [];
  const originalError = console.error;
  console.error = (...args) => captured.push(args.map(value => String(value)).join(' '));

  try {
    await api({ method: 'GET', headers: { 'x-vector-key': configuredKey } }, response);
  } finally {
    console.error = originalError;
  }

  assert.equal(response.code, 500);
  assert.deepEqual(response.body, { ok: false, error: 'owner package unavailable' });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(captured, ['owner-package-stage:OBLIGATIONS_PARSE']);
  assert.equal(captured.join('\n').includes(rawMarker), false);
  assert.equal(captured.join('\n').includes(configuredKey), false);
});

test('Owner live reader and package builder wire every approved diagnostic stage without changing routes', () => {
  const readerSource = readFileSync(new URL('../lib/owner-live-source-reader.js', import.meta.url), 'utf8');
  const decisionSource = readFileSync(new URL('../api/decision-event.js', import.meta.url), 'utf8');
  const readonlySource = readFileSync(new URL('../lib/owner-readonly-api.js', import.meta.url), 'utf8');

  for (const stage of EXPECTED_STAGES.filter(value => !['PACKAGE_BUILD', 'UNCLASSIFIED'].includes(value))) {
    assert.match(
      readerSource,
      new RegExp(`runOwnerPackageStage\\(\\s*['\"]${stage}['\"]`),
      `owner live reader must classify ${stage}`
    );
  }
  assert.match(
    decisionSource,
    /runOwnerPackageStage\(\s*['\"]PACKAGE_BUILD['\"]/
  );
  assert.match(readonlySource, /ownerPackageFailureStage\(/);
  assert.doesNotMatch(decisionSource, /owner-package-stage:[^`'\"\s]*/);
});
