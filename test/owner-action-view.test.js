import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOwnerActionView } from '../lib/owner-action-view.js';

test('selects highest-ranked active decision and exposes start action', () => {
  const result = buildOwnerActionView([
    { ruleId: 'A', active: true, rank: 2, executionStatus: 'В работе', verificationStatus: 'Не проверено' },
    { ruleId: 'B', active: true, rank: 1, executionStatus: 'Не начато', verificationStatus: 'Не проверено' },
    { ruleId: 'C', active: false, rank: 0, executionStatus: 'Не начато', verificationStatus: 'Не проверено' }
  ]);

  assert.equal(result.activeCount, 2);
  assert.equal(result.top.ruleId, 'B');
  assert.deepEqual(result.top.allowedActions, ['start']);
  assert.equal('rank' in result.top, false);
});

test('maps execution lifecycle to context-sensitive actions', () => {
  const inWork = buildOwnerActionView([{ ruleId: 'A', active: true, rank: 1, executionStatus: 'В работе', verificationStatus: 'Не проверено' }]);
  assert.deepEqual(inWork.top.allowedActions, ['complete']);

  const ready = buildOwnerActionView([{ ruleId: 'A', active: true, rank: 1, executionStatus: 'Готово', verificationStatus: 'Не проверено' }]);
  assert.deepEqual(ready.top.allowedActions, ['verify_confirmed', 'verify_no_effect', 'verify_na']);

  const verified = buildOwnerActionView([{ ruleId: 'A', active: true, rank: 1, executionStatus: 'Готово', verificationStatus: 'Подтверждено' }]);
  assert.deepEqual(verified.top.allowedActions, []);
});

test('uses due date then rule id as deterministic tiebreakers', () => {
  const result = buildOwnerActionView([
    { ruleId: 'B', active: true, rank: 1, deadline: '2026-09-04', executionStatus: 'Не начато', verificationStatus: 'Не проверено' },
    { ruleId: 'C', active: true, rank: 1, deadline: '2026-09-03', executionStatus: 'Не начато', verificationStatus: 'Не проверено' },
    { ruleId: 'A', active: true, rank: 1, deadline: '2026-09-03', executionStatus: 'Не начато', verificationStatus: 'Не проверено' }
  ]);

  assert.equal(result.top.ruleId, 'A');
});

test('returns null top when there are no active decisions', () => {
  assert.deepEqual(buildOwnerActionView([{ ruleId: 'A', active: false, rank: 1 }]), { top: null, activeCount: 0 });
});
