import test from 'node:test';
import assert from 'node:assert/strict';
import { createDecisionStateSynchronizer } from '../lib/decision-state-sync-service.js';

function matchingComparison() {
  return {
    total: 2,
    matches: 2,
    mismatches: [],
    results: [
      {
        ruleId: 'DEC-EST-ADJ',
        current: { _row: 3 },
        shadow: { active: true, dueDate: '2026-09-02', amount: 857000, linkedObjects: ['MASTERS-2026-08'] }
      },
      {
        ruleId: 'DEC-CASH-GAP',
        current: { _row: 2 },
        shadow: { active: false, dueDate: null, amount: 0, linkedObjects: [] }
      }
    ]
  };
}

test('dry-run returns planned writes without modifying Sheets', async () => {
  let writes = 0;
  const sync = createDecisionStateSynchronizer({
    spreadsheetId: 'sheet-1',
    runShadow: async () => ({ comparison: matchingComparison() }),
    sheets: { spreadsheets: { values: { batchUpdate: async () => { writes += 1; } } } },
    writesEnabled: false
  });

  const result = await sync({ dryRun: true });

  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.equal(result.total, 2);
  assert.equal(result.matchesBefore, 2);
  assert.equal(result.writeCount, 8);
  assert.equal(writes, 0);
});

test('commit is blocked unless server-side writes flag is enabled', async () => {
  let writes = 0;
  const sync = createDecisionStateSynchronizer({
    spreadsheetId: 'sheet-1',
    runShadow: async () => ({ comparison: matchingComparison() }),
    sheets: { spreadsheets: { values: { batchUpdate: async () => { writes += 1; } } } },
    writesEnabled: false
  });

  await assert.rejects(() => sync({ dryRun: false }), /decision state writes are disabled/);
  assert.equal(writes, 0);
});

test('enabled commit uses one atomic batch and verifies a second shadow read', async () => {
  const batchUpdates = [];
  let shadowRuns = 0;
  const sync = createDecisionStateSynchronizer({
    spreadsheetId: 'sheet-1',
    runShadow: async () => {
      shadowRuns += 1;
      return { comparison: matchingComparison() };
    },
    sheets: {
      spreadsheets: {
        values: {
          batchUpdate: async (request) => { batchUpdates.push(request); return { data: {} }; }
        }
      }
    },
    writesEnabled: true
  });

  const result = await sync({ dryRun: false });

  assert.equal(batchUpdates.length, 1);
  assert.equal(batchUpdates[0].spreadsheetId, 'sheet-1');
  assert.equal(batchUpdates[0].requestBody.valueInputOption, 'RAW');
  assert.equal(batchUpdates[0].requestBody.data.length, 8);
  assert.equal(shadowRuns, 2);
  assert.equal(result.verified, true);
  assert.equal(result.matchesAfter, 2);
});

test('commit fails closed when post-write shadow verification drifts', async () => {
  let shadowRuns = 0;
  const sync = createDecisionStateSynchronizer({
    spreadsheetId: 'sheet-1',
    runShadow: async () => {
      shadowRuns += 1;
      if (shadowRuns === 1) return { comparison: matchingComparison() };
      return { comparison: { total: 2, matches: 1, mismatches: [{ ruleId: 'DEC-EST-ADJ' }], results: [] } };
    },
    sheets: { spreadsheets: { values: { batchUpdate: async () => ({ data: {} }) } } },
    writesEnabled: true
  });

  await assert.rejects(() => sync({ dryRun: false }), /post-write shadow verification failed/);
});
