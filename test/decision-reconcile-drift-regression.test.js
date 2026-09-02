import test from 'node:test';
import assert from 'node:assert/strict';
import { createDecisionStateSynchronizer } from '../lib/decision-state-sync-service.js';

function resultRow({ active = true } = {}) {
  return {
    ruleId: 'DEC-CASH-GAP',
    current: { _row: 2 },
    shadow: {
      active,
      dueDate: active ? '2026-09-05' : null,
      amount: active ? 269434.64 : 0,
      linkedObjects: []
    }
  };
}

test('enabled reconciliation repairs pre-write drift and verifies clean post-write shadow', async () => {
  let shadowRuns = 0;
  let backupReads = 0;
  const writes = [];
  const drift = {
    total: 1,
    matches: 0,
    mismatches: [{ ruleId: 'DEC-CASH-GAP', fields: ['active', 'amount', 'dueDate'] }],
    results: [resultRow({ active: true })]
  };
  const clean = {
    total: 1,
    matches: 1,
    mismatches: [],
    results: [resultRow({ active: true })]
  };

  const sync = createDecisionStateSynchronizer({
    spreadsheetId: 'sheet-1',
    runShadow: async () => ({ comparison: ++shadowRuns === 1 ? drift : clean }),
    sheets: {
      spreadsheets: {
        values: {
          batchGet: async ({ ranges }) => {
            backupReads += 1;
            return {
              data: {
                valueRanges: ranges.map((range, index) => ({
                  range,
                  values: [[`=ORIGINAL_${index}`]]
                }))
              }
            };
          },
          batchUpdate: async (request) => {
            writes.push(request);
            return { data: {} };
          }
        }
      }
    },
    writesEnabled: true
  });

  const result = await sync({ dryRun: false });

  assert.equal(backupReads, 1);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].requestBody.valueInputOption, 'RAW');
  assert.equal(shadowRuns, 2);
  assert.equal(result.verified, true);
  assert.equal(result.matchesBefore, 0);
  assert.equal(result.matchesAfter, 1);
});
