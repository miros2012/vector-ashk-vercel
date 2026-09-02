import test from 'node:test';
import assert from 'node:assert/strict';
import { consumeOwnerActionQueue } from '../lib/owner-action-queue-consumer.js';

function ready(overrides = {}) {
  return {
    _row: 2,
    requestId: 'req-1',
    ruleId: 'DEC-1',
    action: 'В работу',
    expectedExecutionStatus: 'Не начато',
    actor: 'Собственник',
    result: '',
    verificationStatus: '',
    actualEffect: null,
    evidence: '',
    commandStatus: 'READY',
    createdAt: '2026-09-02T05:00:00.000Z',
    ...overrides
  };
}

test('claims READY command, executes existing lifecycle, and records SUCCESS', async () => {
  const statuses = [];
  const commands = [];
  const result = await consumeOwnerActionQueue({
    commands: [ready()],
    markCommand: async (row, update) => statuses.push({ row, ...update }),
    executeCommand: async (command) => {
      commands.push(command);
      return { ok: true, idempotent: false, executionStatus: 'В работе' };
    },
    now: () => new Date('2026-09-02T05:05:00.000Z')
  });

  assert.equal(commands.length, 1);
  assert.equal(commands[0].action, 'start');
  assert.deepEqual(statuses.map(({ commandStatus }) => commandStatus), ['SENT', 'SUCCESS']);
  assert.equal(statuses[1].processedAt, '2026-09-02T05:05:00.000Z');
  assert.deepEqual(result, { ready: 1, succeeded: 1, failed: 0 });
});

test('records one malformed row as ERROR and continues with the next command', async () => {
  const statuses = [];
  let executions = 0;
  const result = await consumeOwnerActionQueue({
    commands: [ready({ requestId: '', _row: 2 }), ready({ requestId: 'req-2', _row: 3 })],
    markCommand: async (row, update) => statuses.push({ row, ...update }),
    executeCommand: async () => { executions += 1; return { ok: true, idempotent: false }; },
    now: () => new Date('2026-09-02T05:05:00.000Z')
  });

  assert.equal(executions, 1);
  assert.equal(statuses.find(({ row }) => row === 2).commandStatus, 'ERROR');
  assert.equal(statuses.at(-1).commandStatus, 'SUCCESS');
  assert.deepEqual(result, { ready: 2, succeeded: 1, failed: 1 });
});

test('treats an idempotent lifecycle response as SUCCESS without inventing another event', async () => {
  const statuses = [];
  const result = await consumeOwnerActionQueue({
    commands: [ready()],
    markCommand: async (row, update) => statuses.push({ row, ...update }),
    executeCommand: async () => ({ ok: true, idempotent: true, executionStatus: 'В работе' }),
    now: () => new Date('2026-09-02T05:05:00.000Z')
  });

  assert.equal(statuses.at(-1).commandStatus, 'SUCCESS');
  assert.match(statuses.at(-1).response, /idempotent/);
  assert.deepEqual(result, { ready: 1, succeeded: 1, failed: 0 });
});

test('reports the final command result to the control transport', async () => {
  const completed = [];
  await consumeOwnerActionQueue({
    commands: [ready()],
    markCommand: async () => {},
    executeCommand: async () => ({ ok: true, idempotent: false, executionStatus: 'В работе' }),
    onCommandResult: async (result) => completed.push(result),
    now: () => new Date('2026-09-02T05:05:00.000Z')
  });

  assert.equal(completed.length, 1);
  assert.equal(completed[0].requestId, 'req-1');
  assert.equal(completed[0].commandStatus, 'SUCCESS');
  assert.equal(completed[0].processedAt, '2026-09-02T05:05:00.000Z');
});
