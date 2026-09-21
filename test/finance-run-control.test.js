import test from 'node:test';
import assert from 'node:assert/strict';
import { createFinanceRunControl } from '../lib/finance-run-control.js';

const NOW = new Date('2026-09-18T00:00:00.000Z');

function storeFake({
  lease = { ok: true },
  retry = null,
  retryState = { value: retry },
  append = { ok: true },
  write = { ok: true },
  clear = { ok: true }
} = {}) {
  const calls = [];
  return {
    calls,
    async ensureSchema() {
      calls.push(['ensureSchema']);
      return { ok: true };
    },
    async acquireLease(input) {
      calls.push(['acquireLease', input]);
      return lease;
    },
    async releaseLease(input) {
      calls.push(['releaseLease', input]);
      return { ok: true, released: true };
    },
    async appendAttempt(entry) {
      calls.push(['appendAttempt', entry]);
      return typeof append === 'function' ? append(entry) : append;
    },
    async readRetry() {
      calls.push(['readRetry']);
      return retryState.value;
    },
    async writeRetry(state) {
      calls.push(['writeRetry', state]);
      const result = typeof write === 'function' ? await write(state) : write;
      if (result?.ok === true) retryState.value = { ...state };
      return result;
    },
    async clearRetry() {
      calls.push(['clearRetry']);
      const result = typeof clear === 'function' ? await clear() : clear;
      if (result?.ok === true) retryState.value = null;
      return result;
    }
  };
}

function control(store, randomBytes = () => Buffer.from([0xab, 0xcd])) {
  return createFinanceRunControl({
    store,
    now: () => NOW,
    randomBytes,
    deploymentSha: 'deploy-sha',
    log: () => {}
  });
}

test('a busy lease prevents a stage executor from running', async () => {
  const store = storeFake({ lease: { ok: false, busy: true } });
  const runControl = control(store);
  const context = await runControl.begin({ trigger: 'cron', mode: 'nightly' });
  let ran = false;

  const result = await runControl.runStage(context, {
    stage: 'receivablesSource',
    attempt: 1,
    execute: async () => {
      ran = true;
      return { ok: true, statusCode: 200 };
    }
  });

  assert.deepEqual(context, { ok: false, statusCode: 409 });
  assert.deepEqual(result, { ok: false, statusCode: 409 });
  assert.deepEqual(store.calls.find(([name]) => name === 'acquireLease')[1], {
    runId: '2026-09-18T00:00:00.000Z-abcd',
    leaseMs: 360_000
  });
  assert.equal(ran, false);
  assert.equal(store.calls.some(([name]) => name === 'appendAttempt'), false);
});

test('retryable failures on attempts one and two persist the policy retry state', async () => {
  const store = storeFake();
  const runControl = control(store);
  const context = await runControl.begin({ trigger: 'cron', mode: 'nightly' });

  const first = await runControl.runStage(context, {
    stage: 'receivablesSource',
    attempt: 1,
    execute: async () => ({ ok: false, statusCode: 503, errorClass: 'ASHK_FETCH', retryable: true })
  });
  const second = await runControl.runStage(context, {
    stage: 'ropPublish',
    attempt: 2,
    execute: async () => ({ ok: false, statusCode: 502, errorClass: 'ROP_PUBLISH', retryable: true })
  });

  assert.deepEqual(first, { ok: false, statusCode: 503, errorClass: 'ASHK_FETCH', retryable: true });
  assert.deepEqual(second, { ok: false, statusCode: 502, errorClass: 'ROP_PUBLISH', retryable: true });
  assert.deepEqual(store.calls.filter(([name]) => name === 'writeRetry').map(([, state]) => state), [
    {
      finance_retry_stage: 'receivablesSource',
      finance_retry_attempt: 2,
      finance_retry_after_utc: '2026-09-18T00:10:00.000Z',
      finance_retry_origin_run_id: '2026-09-18T00:00:00.000Z-abcd',
      finance_retry_error_class: 'ASHK_FETCH'
    },
    {
      finance_retry_stage: 'ropPublish',
      finance_retry_attempt: 3,
      finance_retry_after_utc: '2026-09-18T00:30:00.000Z',
      finance_retry_origin_run_id: '2026-09-18T00:00:00.000Z-abcd',
      finance_retry_error_class: 'ROP_PUBLISH'
    }
  ]);
});

test('attempt-three and permanent failures clear rather than retain automatic retry state', async () => {
  const store = storeFake();
  const runControl = control(store);
  const context = await runControl.begin({ trigger: 'manual', mode: 'nightly' });

  await runControl.runStage(context, {
    stage: 'ropPublish',
    attempt: 3,
    execute: async () => ({ ok: false, statusCode: 502, errorClass: 'ROP_PUBLISH', retryable: true })
  });
  await runControl.runStage(context, {
    stage: 'receivablesSource',
    attempt: 1,
    execute: async () => ({ ok: false, statusCode: 502, errorClass: 'READBACK_MISMATCH', retryable: false })
  });

  assert.equal(store.calls.filter(([name]) => name === 'writeRetry').length, 0);
  assert.equal(store.calls.filter(([name]) => name === 'clearRetry').length, 2);
});

test('a ledger write failure disables retry and returns only the safe ledger failure', async () => {
  const store = storeFake({ append: { ok: false, errorClass: 'LEDGER_WRITE', providerMessage: 'customer Alice secret=123' } });
  const runControl = control(store);
  const context = await runControl.begin({ trigger: 'cron', mode: 'nightly' });

  const result = await runControl.runStage(context, {
    stage: 'receivablesSource',
    attempt: 1,
    execute: async () => ({ ok: false, statusCode: 503, errorClass: 'ASHK_FETCH', retryable: true })
  });

  assert.deepEqual(result, { ok: false, statusCode: 500, errorClass: 'LEDGER_WRITE', retryable: false });
  assert.equal(JSON.stringify(result).includes('Alice'), false);
  assert.equal(store.calls.some(([name]) => name === 'writeRetry'), false);
  assert.equal(store.calls.filter(([name]) => name === 'clearRetry').length, 1);
});

test('a due successful recovery records RECOVERED before clearing retry state', async () => {
  const store = storeFake({ retry: {
    finance_retry_stage: 'ropPublish',
    finance_retry_attempt: 2,
    finance_retry_after_utc: '2026-09-17T23:59:00.000Z',
    finance_retry_origin_run_id: 'original-run',
    finance_retry_error_class: 'ROP_PUBLISH'
  } });
  const runControl = control(store);
  const context = await runControl.begin({ trigger: 'cron', mode: 'nightly' });

  assert.deepEqual(await runControl.pendingRecovery(context), {
    stage: 'ropPublish',
    attempt: 2,
    originRunId: 'original-run',
    errorClass: 'ROP_PUBLISH'
  });
  const result = await runControl.runStage(context, {
    stage: 'ropPublish',
    attempt: 2,
    execute: async () => ({ ok: true, statusCode: 200, body: { private: 'not ledger data' } })
  });

  assert.deepEqual(result, { ok: true, statusCode: 200, body: { private: 'not ledger data' } });
  const append = store.calls.find(([name]) => name === 'appendAttempt');
  assert.deepEqual(append[1], {
    runId: '2026-09-18T00:00:00.000Z-abcd',
    startedAtUtc: '2026-09-18T00:00:00.000Z',
    finishedAtUtc: '2026-09-18T00:00:00.000Z',
    trigger: 'cron',
    mode: 'nightly',
    stage: 'ropPublish',
    attempt: 2,
    result: 'RECOVERED',
    statusCode: 200,
    errorClass: '',
    retryable: false,
    retryAfterUtc: '',
    deploymentSha: 'deploy-sha'
  });
  assert.deepEqual(store.calls.slice(-2).map(([name]) => name), ['appendAttempt', 'clearRetry']);
});

test('a failed recovery ledger append leaves its durable claim blocking later execution', async () => {
  const retryState = { value: {
    finance_retry_stage: 'ropPublish',
    finance_retry_attempt: 2,
    finance_retry_after_utc: '2026-09-17T23:59:00.000Z',
    finance_retry_origin_run_id: 'original-run',
    finance_retry_error_class: 'ROP_PUBLISH'
  } };
  const store = storeFake({
    retryState,
    append: { ok: false, errorClass: 'LEDGER_WRITE' },
    clear: { ok: false, errorClass: 'LEDGER_WRITE' }
  });
  const first = control(store);
  const firstContext = await first.begin({ trigger: 'cron', mode: 'nightly' });
  await first.pendingRecovery(firstContext);
  let executions = 0;

  assert.deepEqual(await first.runStage(firstContext, {
    stage: 'ropPublish',
    attempt: 2,
    execute: async () => {
      executions += 1;
      return { ok: true, statusCode: 200 };
    }
  }), { ok: false, statusCode: 500, errorClass: 'LEDGER_WRITE', retryable: false });
  assert.equal(executions, 1);
  assert.deepEqual(retryState.value, {
    finance_retry_stage: 'ropPublish',
    finance_retry_attempt: 2,
    finance_retry_after_utc: 'CLAIMED',
    finance_retry_origin_run_id: '2026-09-18T00:00:00.000Z-abcd',
    finance_retry_error_class: 'ROP_PUBLISH'
  });
  await first.finish(firstContext);

  const second = control(store, () => Buffer.from([0xef, 0x01]));
  const secondContext = await second.begin({ trigger: 'cron', mode: 'nightly' });
  assert.deepEqual(await second.pendingRecovery(secondContext), {
    ok: false, statusCode: 500, errorClass: 'LEDGER_WRITE', retryable: false
  });
  assert.deepEqual(await second.runStage(secondContext, {
    stage: 'ropPublish',
    attempt: 2,
    execute: async () => {
      executions += 1;
      return { ok: true, statusCode: 200 };
    }
  }), { ok: false, statusCode: 500, errorClass: 'LEDGER_WRITE', retryable: false });
  assert.equal(executions, 1);
});

test('a recovered success whose retry clear fails leaves its durable claim blocking later execution', async () => {
  const retryState = { value: {
    finance_retry_stage: 'receivablesSource',
    finance_retry_attempt: 2,
    finance_retry_after_utc: '2026-09-17T23:59:00.000Z',
    finance_retry_origin_run_id: 'original-run',
    finance_retry_error_class: 'SHEETS_READBACK'
  } };
  const store = storeFake({ retryState, clear: { ok: false, errorClass: 'LEDGER_WRITE' } });
  const first = control(store);
  const firstContext = await first.begin({ trigger: 'cron', mode: 'nightly' });
  await first.pendingRecovery(firstContext);
  let executions = 0;

  assert.deepEqual(await first.runStage(firstContext, {
    stage: 'receivablesSource',
    attempt: 2,
    execute: async () => {
      executions += 1;
      return { ok: true, statusCode: 200 };
    }
  }), { ok: false, statusCode: 500, errorClass: 'LEDGER_WRITE', retryable: false });
  assert.equal(executions, 1);
  assert.equal(retryState.value.finance_retry_after_utc, 'CLAIMED');
  await first.finish(firstContext);

  const second = control(store, () => Buffer.from([0xef, 0x01]));
  const secondContext = await second.begin({ trigger: 'cron', mode: 'nightly' });
  assert.deepEqual(await second.pendingRecovery(secondContext), {
    ok: false, statusCode: 500, errorClass: 'LEDGER_WRITE', retryable: false
  });
  assert.deepEqual(await second.runStage(secondContext, {
    stage: 'receivablesSource',
    attempt: 2,
    execute: async () => {
      executions += 1;
      return { ok: true, statusCode: 200 };
    }
  }), { ok: false, statusCode: 500, errorClass: 'LEDGER_WRITE', retryable: false });
  assert.equal(executions, 1);
});

test('a stale claimed retry is reclaimed only with proof from the expired lease owner', async () => {
  const retryState = { value: {
    finance_retry_stage: 'receivablesSource',
    finance_retry_attempt: 2,
    finance_retry_after_utc: 'CLAIMED',
    finance_retry_origin_run_id: 'stale-run',
    finance_retry_error_class: 'TIME_BUDGET'
  } };
  const store = storeFake({
    retryState,
    lease: {
      ok: true,
      leaseUntilUtc: '2026-09-18T00:04:00.000Z',
      reclaimedLeaseOwner: 'stale-run',
      reclaimedLeaseUntilUtc: '2026-09-17T23:59:00.000Z'
    }
  });
  const runControl = control(store);
  const context = await runControl.begin({ trigger: 'cron', mode: 'intraday' });

  assert.deepEqual(await runControl.pendingRecovery(context), {
    stage: 'receivablesSource',
    attempt: 2,
    originRunId: 'stale-run',
    errorClass: 'TIME_BUDGET'
  });
  assert.deepEqual(retryState.value, {
    finance_retry_stage: 'receivablesSource',
    finance_retry_attempt: 2,
    finance_retry_after_utc: 'CLAIMED',
    finance_retry_origin_run_id: '2026-09-18T00:00:00.000Z-abcd',
    finance_retry_error_class: 'TIME_BUDGET'
  });
});

test('finish releases an acquired lease even after a stage result is returned', async () => {
  const store = storeFake();
  const runControl = control(store);
  const context = await runControl.begin({ trigger: 'cron', mode: 'nightly' });

  await runControl.runStage(context, {
    stage: 'ropPublish',
    attempt: 1,
    execute: async () => ({ ok: true, statusCode: 200 })
  });

  assert.deepEqual(await runControl.finish(context), { ok: true, released: true });
  assert.deepEqual(store.calls.at(-1), ['releaseLease', { runId: '2026-09-18T00:00:00.000Z-abcd' }]);
});

test('pendingRecovery blocks malformed nonempty retry state without invoking execute', async () => {
  for (const patch of [
    { finance_retry_stage: '' }, { finance_retry_attempt: 4 },
    { finance_retry_after_utc: '' }, { finance_retry_after_utc: 'bad' },
    { finance_retry_origin_run_id: '' }, { finance_retry_error_class: 'AUTH' }
  ]) {
    const store = storeFake({ retry: {
      finance_retry_stage: 'ropPublish', finance_retry_attempt: 2,
      finance_retry_after_utc: '2026-09-17T23:59:00.000Z',
      finance_retry_origin_run_id: 'original', finance_retry_error_class: 'ROP_PUBLISH', ...patch
    } });
    const runControl = control(store);
    const context = await runControl.begin();
    assert.equal((await runControl.pendingRecovery(context))?.errorClass, 'LEDGER_WRITE');
    let executed = false;
    const result = await runControl.runStage(context, {
      stage: 'ropPublish', attempt: 2, execute: async () => { executed = true; return { ok: true }; }
    });
    assert.equal(result.errorClass, 'LEDGER_WRITE');
    assert.equal(executed, false);
  }
});

test('TIME_BUDGET is ledgered and scheduled without starting a late stage', async () => {
  for (const [options, elapsed] of [[{}, 211_000], [{ minimumRemainingMs: 30_000 }, 271_000]]) {
    let clock = NOW.getTime();
    const store = storeFake();
    const runControl = createFinanceRunControl({ store, now: () => new Date(clock), log: () => {}, ...options });
    const context = await runControl.begin({ trigger: 'cron', mode: 'nightly' });
    clock += elapsed;
    let executions = 0;
    const result = await runControl.runStage(context, {
      stage: 'receivablesSource', attempt: 1,
      execute: async () => { executions += 1; return { ok: true }; }
    });
    assert.deepEqual(result, { ok: false, statusCode: 503, errorClass: 'TIME_BUDGET', retryable: true });
    assert.equal(executions, 0);
    const entry = store.calls.find(([name]) => name === 'appendAttempt')[1];
    assert.equal(entry.errorClass, 'TIME_BUDGET');
    assert.equal(entry.result, 'FAILED');
    const retry = store.calls.find(([name]) => name === 'writeRetry')[1];
    assert.equal(retry.finance_retry_attempt, 2);
    assert.equal(retry.finance_retry_error_class, 'TIME_BUDGET');
    assert.equal(Date.parse(retry.finance_retry_after_utc) - clock, 600_000);
  }
});

test('stage budget includes time spent before lazy controller initialization', async () => {
  const store = storeFake();
  const runControl = createFinanceRunControl({
    store, requestStartedAt: new Date(NOW.getTime() - 220_000), now: () => NOW, log: () => {}
  });
  const context = await runControl.begin();
  let executed = false;
  const result = await runControl.runStage(context, {
    stage: 'ropPublish', attempt: 1, execute: async () => { executed = true; return { ok: true }; }
  });
  assert.equal(result.errorClass, 'TIME_BUDGET');
  assert.equal(executed, false);
});
