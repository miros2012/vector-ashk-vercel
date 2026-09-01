import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOwnerActionRequest } from '../lib/owner-action-request.js';

test('maps dashboard actions to existing decision-event commands with stable idempotency key', () => {
  const first = normalizeOwnerActionRequest({ ruleId:'DEC-1', expectedExecutionStatus:'Не начато', requestedAction:'В работу' });
  const retry = normalizeOwnerActionRequest({ ruleId:'DEC-1', expectedExecutionStatus:'Не начато', requestedAction:'В работу' });
  assert.equal(first.action, 'start');
  assert.equal(first.expectedExecutionStatus, 'Не начато');
  assert.equal(first.actor, 'Owner Dashboard');
  assert.equal(first.requestId, retry.requestId);
  assert.match(first.requestId, /^OAR-/);
});

test('maps completion result and evidence', () => {
  const command = normalizeOwnerActionRequest({ ruleId:'DEC-1', expectedExecutionStatus:'В работе', requestedAction:'Готово', result:'Оплачено', evidence:'Платёжка' });
  assert.equal(command.action, 'complete');
  assert.equal(command.result, 'Оплачено');
  assert.equal(command.evidence, 'Платёжка');
});

test('maps verification states and requires numeric effect for confirmed verification', () => {
  const confirmed = normalizeOwnerActionRequest({ ruleId:'DEC-1', expectedExecutionStatus:'Готово', requestedAction:'Подтвердить эффект', actualEffect:'125000' });
  assert.equal(confirmed.action, 'verify');
  assert.equal(confirmed.verificationStatus, 'Подтверждено');
  assert.equal(confirmed.actualEffect, 125000);

  assert.equal(normalizeOwnerActionRequest({ ruleId:'DEC-1', expectedExecutionStatus:'Готово', requestedAction:'Нет эффекта' }).verificationStatus, 'Нет эффекта');
  assert.equal(normalizeOwnerActionRequest({ ruleId:'DEC-1', expectedExecutionStatus:'Готово', requestedAction:'Не применимо' }).verificationStatus, 'Не применимо');
  assert.throws(() => normalizeOwnerActionRequest({ ruleId:'DEC-1', expectedExecutionStatus:'Готово', requestedAction:'Подтвердить эффект', actualEffect:'' }), /actualEffect/);
});

test('blank action means no pending request', () => {
  assert.equal(normalizeOwnerActionRequest({ ruleId:'DEC-1', requestedAction:'' }), null);
});
