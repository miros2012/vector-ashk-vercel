import test from 'node:test';
import assert from 'node:assert/strict';
import {
  finalizeOwnerActionControl,
  stageOwnerActionControl
} from '../lib/owner-action-control-transport.js';

function control(overrides = {}) {
  return {
    ruleId: 'DEC-CRIT-DUE',
    expectedExecutionStatus: 'Не начато',
    requestedAction: 'В работу',
    result: '',
    evidence: '',
    actualEffect: null,
    currentRequestId: '',
    ...overrides
  };
}

test('stages one dashboard action as a READY queue command', async () => {
  const appended = [];
  const states = [];
  const result = await stageOwnerActionControl({
    control: control(),
    appendCommand: async (command) => appended.push(command),
    setControlState: async (state) => states.push(state),
    requestId: () => 'owner-req-1',
    now: () => new Date('2026-09-02T06:00:00.000Z')
  });

  assert.deepEqual(appended, [{
    requestId: 'owner-req-1',
    ruleId: 'DEC-CRIT-DUE',
    action: 'В работу',
    expectedExecutionStatus: 'Не начато',
    actor: 'Собственник',
    result: '',
    verificationStatus: '',
    actualEffect: null,
    evidence: '',
    commandStatus: 'READY',
    response: '',
    createdAt: '2026-09-02T06:00:00.000Z',
    processedAt: ''
  }]);
  assert.deepEqual(states, [{
    currentRequestId: 'owner-req-1',
    processedRequestId: '',
    transportStatus: 'READY',
    lastError: '',
    updatedAt: '2026-09-02T06:00:00.000Z'
  }]);
  assert.deepEqual(result, { staged: 1, requestId: 'owner-req-1' });
});

test('does not stage a duplicate while the same control request is pending', async () => {
  let appends = 0;
  const result = await stageOwnerActionControl({
    control: control({ currentRequestId: 'owner-req-1' }),
    appendCommand: async () => { appends += 1; },
    setControlState: async () => {},
    requestId: () => 'owner-req-2'
  });

  assert.equal(appends, 0);
  assert.deepEqual(result, { staged: 0, requestId: 'owner-req-1' });
});

test('does nothing when the owner has not selected an action', async () => {
  let appends = 0;
  const result = await stageOwnerActionControl({
    control: control({ requestedAction: '' }),
    appendCommand: async () => { appends += 1; },
    setControlState: async () => {},
    requestId: () => 'owner-req-1'
  });

  assert.equal(appends, 0);
  assert.deepEqual(result, { staged: 0, requestId: null });
});

test('successful processing clears inputs and leaves an auditable processed request id', async () => {
  const states = [];
  let clears = 0;
  await finalizeOwnerActionControl({
    result: {
      requestId:'req-1', commandStatus:'SUCCESS', response:'{"ok":true}',
      processedAt:'2026-09-02T06:05:00.000Z'
    },
    setControlState: async (state) => states.push(state),
    clearDashboardInputs: async () => { clears += 1; }
  });

  assert.deepEqual(states, [{
    currentRequestId:'', processedRequestId:'req-1', transportStatus:'SUCCESS',
    lastError:'', updatedAt:'2026-09-02T06:05:00.000Z'
  }]);
  assert.equal(clears, 1);
});

test('failed processing preserves dashboard inputs and current request for inspection', async () => {
  const states = [];
  let clears = 0;
  await finalizeOwnerActionControl({
    result: {
      requestId:'req-1', commandStatus:'ERROR', response:'actualEffect is required',
      processedAt:'2026-09-02T06:05:00.000Z'
    },
    setControlState: async (state) => states.push(state),
    clearDashboardInputs: async () => { clears += 1; }
  });

  assert.deepEqual(states, [{
    currentRequestId:'req-1', processedRequestId:'', transportStatus:'ERROR',
    lastError:'actualEffect is required', updatedAt:'2026-09-02T06:05:00.000Z'
  }]);
  assert.equal(clears, 0);
});
