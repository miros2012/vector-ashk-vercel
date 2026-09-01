import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDecisionStateUpdates } from '../lib/decision-state-sync.js';

test('builds writes only for backend-owned financial state columns H/J/M/P', () => {
  const comparison = {
    total: 2,
    results: [
      {
        ruleId: 'DEC-EST-ADJ',
        current: { _row: 3 },
        shadow: {
          active: true,
          dueDate: '2026-09-02',
          amount: 857000,
          linkedObjects: ['MASTERS-2026-08']
        }
      },
      {
        ruleId: 'DEC-CASH-GAP',
        current: { _row: 2 },
        shadow: {
          active: false,
          dueDate: null,
          amount: 0,
          linkedObjects: []
        }
      }
    ]
  };

  const updates = buildDecisionStateUpdates(comparison);

  assert.deepEqual(updates.map((item) => item.range), [
    "'Решения'!H3",
    "'Решения'!J3",
    "'Решения'!M3",
    "'Решения'!P3",
    "'Решения'!H2",
    "'Решения'!J2",
    "'Решения'!M2",
    "'Решения'!P2"
  ]);
  assert.equal(updates[0].values[0][0], 46267);
  assert.equal(updates[1].values[0][0], 'Активно');
  assert.equal(updates[2].values[0][0], 857000);
  assert.equal(updates[3].values[0][0], 'MASTERS-2026-08');
  assert.equal(updates[4].values[0][0], '');
  assert.equal(updates[5].values[0][0], 'Неактивно');
  assert.equal(updates[6].values[0][0], 0);
  assert.equal(updates[7].values[0][0], '');
});

test('keeps active rule amount blank when evaluator intentionally has no amount', () => {
  const updates = buildDecisionStateUpdates({
    total: 1,
    results: [{
      ruleId: 'DEC-UNCONF-OBL',
      current: { _row: 4 },
      shadow: { active: true, dueDate: '2026-09-02', amount: null, linkedObjects: ['TAX-RESERVE'] }
    }]
  });

  assert.equal(updates.find((item) => item.range.endsWith('M4')).values[0][0], '');
});

test('refuses to sync when a catalog rule has no matching current row', () => {
  assert.throws(
    () => buildDecisionStateUpdates({
      total: 1,
      results: [{ ruleId: 'NEW-RULE', current: null, shadow: { active: true } }]
    }),
    /missing current decision row/
  );
});
