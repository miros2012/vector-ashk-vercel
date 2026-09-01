import test from 'node:test';
import assert from 'node:assert/strict';
import { executeDecisionCommand } from '../lib/decision-command.js';

function current(overrides = {}) {
  return {
    ruleId: 'DEC-CRIT-DUE',
    ruleStatus: 'Активно',
    executionStatus: 'Не начато',
    verificationStatus: 'Не проверено',
    plannedEffect: 1000,
    actualEffect: null,
    startedAt: null,
    completedAt: null,
    result: '',
    lastCheckedAt: null,
    ...overrides
  };
}

function deps(overrides = {}) {
  const writes = [];
  const events = [];
  return {
    writes,
    events,
    getDecision: async () => current(),
    hasEvent: async () => false,
    writeDecision: async (ruleId, next) => writes.push({ ruleId, next }),
    appendEvent: async (event) => events.push(event),
    now: () => new Date('2026-09-01T12:00:00.000Z'),
    ...overrides
  };
}

test('executes start and appends one event', async () => {
  const d = deps();
  const result = await executeDecisionCommand({
    command: { ruleId:'DEC-CRIT-DUE', action:'start', actor:'Собственник', requestId:'req-1', expectedExecutionStatus:'Не начато' },
    ...d
  });
  assert.equal(result.executionStatus, 'В работе');
  assert.equal(result.idempotent, false);
  assert.equal(d.writes.length, 1);
  assert.equal(d.events.length, 1);
  assert.equal(d.events[0].eventId, 'req-1');
});

test('duplicate requestId is idempotent', async () => {
  const d = deps({
    getDecision: async () => current({ executionStatus:'В работе' }),
    hasEvent: async (id) => id === 'req-1'
  });
  const result = await executeDecisionCommand({ command:{ ruleId:'DEC-CRIT-DUE', action:'start', actor:'Собственник', requestId:'req-1' }, ...d });
  assert.equal(result.idempotent, true);
  assert.equal(d.writes.length, 0);
  assert.equal(d.events.length, 0);
});

test('rejects stale execution state with 409', async () => {
  const d = deps({ getDecision: async () => current({ executionStatus:'В работе' }) });
  await assert.rejects(
    executeDecisionCommand({ command:{ ruleId:'DEC-CRIT-DUE', action:'complete', actor:'Собственник', expectedExecutionStatus:'Не начато' }, ...d }),
    (error) => error.statusCode === 409 && /stale/.test(error.message)
  );
});

test('rejects inactive rule with 409', async () => {
  const d = deps({ getDecision: async () => current({ ruleStatus:'Неактивно' }) });
  await assert.rejects(
    executeDecisionCommand({ command:{ ruleId:'DEC-CRIT-DUE', action:'start', actor:'Собственник' }, ...d }),
    (error) => error.statusCode === 409 && /inactive/.test(error.message)
  );
});

test('confirmed verification requires actualEffect', async () => {
  const d = deps({ getDecision: async () => current({ executionStatus:'Готово' }) });
  await assert.rejects(
    executeDecisionCommand({ command:{ ruleId:'DEC-CRIT-DUE', action:'verify', actor:'Собственник', verificationStatus:'Подтверждено' }, ...d }),
    (error) => error.statusCode === 400 && /actualEffect/.test(error.message)
  );
});
