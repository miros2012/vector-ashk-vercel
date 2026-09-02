import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOwnerActionCommand } from '../lib/owner-action-command.js';

test('normalizes a READY queue row into the existing decision lifecycle command', () => {
  const command = normalizeOwnerActionCommand({
    requestId: 'owner-20260902-001',
    ruleId: 'DEC-CRIT-DUE',
    action: 'Подтвердить эффект',
    expectedExecutionStatus: 'Готово',
    actor: 'Собственник',
    result: 'Платёж подготовлен',
    verificationStatus: 'Подтверждено',
    actualEffect: '125000',
    evidence: 'Платёжное поручение №42',
    commandStatus: 'READY'
  });

  assert.deepEqual(command, {
    requestId: 'owner-20260902-001',
    ruleId: 'DEC-CRIT-DUE',
    action: 'verify',
    expectedExecutionStatus: 'Готово',
    actor: 'Собственник',
    result: 'Платёж подготовлен',
    verificationStatus: 'Подтверждено',
    actualEffect: 125000,
    evidence: 'Платёжное поручение №42'
  });
});

test('maps each owner-facing action without creating a second lifecycle', () => {
  const base = {
    requestId: 'req-1', ruleId: 'DEC-1', actor: 'Owner', commandStatus: 'READY'
  };
  assert.equal(normalizeOwnerActionCommand({ ...base, action: 'В работу', expectedExecutionStatus: 'Не начато' }).action, 'start');
  assert.equal(normalizeOwnerActionCommand({ ...base, action: 'Готово', expectedExecutionStatus: 'В работе' }).action, 'complete');
  assert.deepEqual(
    normalizeOwnerActionCommand({ ...base, action: 'Нет эффекта', expectedExecutionStatus: 'Готово' }),
    {
      requestId: 'req-1', ruleId: 'DEC-1', action: 'verify',
      expectedExecutionStatus: 'Готово', actor: 'Owner', result: '',
      verificationStatus: 'Нет эффекта', actualEffect: null, evidence: ''
    }
  );
});

test('rejects malformed queue rows before the Decision Engine can be called', () => {
  assert.throws(
    () => normalizeOwnerActionCommand({ requestId: '', ruleId: 'DEC-1', action: 'В работу', actor: 'Owner', commandStatus: 'READY' }),
    /requestId is required/
  );
  assert.throws(
    () => normalizeOwnerActionCommand({ requestId: 'req-1', ruleId: 'DEC-1', action: 'Удалить', actor: 'Owner', commandStatus: 'READY' }),
    /unsupported owner action/
  );
  assert.throws(
    () => normalizeOwnerActionCommand({ requestId: 'req-1', ruleId: 'DEC-1', action: 'В работу', actor: 'Owner', commandStatus: 'SENT' }),
    /commandStatus must be READY/
  );
});
