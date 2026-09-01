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

function formulaBackup(request) {
  return {
    data: {
      valueRanges: request.ranges.map((range, index) => ({
        range,
        values: [[`=ORIGINAL_${index}`]]
      }))
    }
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

test('commit is blocked before backup or write when pre-write shadow has drift', async () => {
  let backupReads = 0;
  let writes = 0;
  const drift = {
    total: 2,
    matches: 1,
    mismatches: [{ ruleId: 'DEC-EST-ADJ' }],
    results: matchingComparison().results
  };
  const sync = createDecisionStateSynchronizer({
    spreadsheetId: 'sheet-1',
    runShadow: async () => ({ comparison: drift }),
    sheets: {
      spreadsheets: {
        values: {
          batchGet: async () => { backupReads += 1; return { data: { valueRanges: [] } }; },
          batchUpdate: async () => { writes += 1; }
        }
      }
    },
    writesEnabled: true
  });

  await assert.rejects(() => sync({ dryRun: false }), /pre-write shadow verification failed/);
  assert.equal(backupReads, 0);
  assert.equal(writes, 0);
});

test('enabled commit backs up formulas, uses one atomic write batch, and verifies a second shadow read', async () => {
  const batchGets = [];
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
          batchGet: async (request) => {
            batchGets.push(request);
            return formulaBackup(request);
          },
          batchUpdate: async (request) => { batchUpdates.push(request); return { data: {} }; }
        }
      }
    },
    writesEnabled: true
  });

  const result = await sync({ dryRun: false });

  assert.equal(batchGets.length, 1);
  assert.equal(batchGets[0].valueRenderOption, 'FORMULA');
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
  const batchUpdates = [];
  const sync = createDecisionStateSynchronizer({
    spreadsheetId: 'sheet-1',
    runShadow: async () => {
      shadowRuns += 1;
      if (shadowRuns === 1) return { comparison: matchingComparison() };
      return { comparison: { total: 2, matches: 1, mismatches: [{ ruleId: 'DEC-EST-ADJ' }], results: [] } };
    },
    sheets: {
      spreadsheets: {
        values: {
          batchGet: async (request) => formulaBackup(request),
          batchUpdate: async (request) => {
            batchUpdates.push(request);
            return { data: {} };
          }
        }
      }
    },
    writesEnabled: true
  });

  await assert.rejects(() => sync({ dryRun: false }), /post-write shadow verification failed/);
  assert.equal(batchUpdates.length, 2);
  assert.equal(batchUpdates[0].requestBody.valueInputOption, 'RAW');
  assert.equal(batchUpdates[1].requestBody.valueInputOption, 'USER_ENTERED');
});

test('verification drift restores original formulas in a rollback batch', async () => {
  let shadowRuns = 0;
  const reads = [];
  const batches = [];
  const events = [];
  const sync = createDecisionStateSynchronizer({
    spreadsheetId: 'sheet-1',
    runShadow: async () => {
      shadowRuns += 1;
      if (shadowRuns === 1) return { comparison: matchingComparison() };
      return { comparison: { total: 2, matches: 1, mismatches: [{ ruleId: 'DEC-EST-ADJ' }], results: [] } };
    },
    sheets: {
      spreadsheets: {
        values: {
          batchGet: async (request) => {
            events.push('backup');
            reads.push(request);
            return formulaBackup(request);
          },
          batchUpdate: async (request) => {
            events.push(request.requestBody.valueInputOption === 'RAW' ? 'write' : 'rollback');
            batches.push(request);
            return { data: {} };
          }
        }
      }
    },
    writesEnabled: true
  });

  await assert.rejects(() => sync({ dryRun: false }), /post-write shadow verification failed/);

  assert.equal(reads.length, 1);
  assert.deepEqual(reads[0].ranges, [
    "'Решения'!H3", "'Решения'!J3", "'Решения'!M3", "'Решения'!P3",
    "'Решения'!H2", "'Решения'!J2", "'Решения'!M2", "'Решения'!P2"
  ]);
  assert.equal(reads[0].valueRenderOption, 'FORMULA');
  assert.deepEqual(events, ['backup', 'write', 'rollback']);
  assert.equal(batches.length, 2);
  assert.equal(batches[0].requestBody.valueInputOption, 'RAW');
  assert.equal(batches[1].requestBody.valueInputOption, 'USER_ENTERED');
  assert.deepEqual(batches[1].requestBody.data[0], {
    range: "'Решения'!H3",
    values: [['=ORIGINAL_0']]
  });
});

test('primary write failure still attempts formula rollback before returning failure', async () => {
  const events = [];
  let writeCalls = 0;
  const sync = createDecisionStateSynchronizer({
    spreadsheetId: 'sheet-1',
    runShadow: async () => ({ comparison: matchingComparison() }),
    sheets: {
      spreadsheets: {
        values: {
          batchGet: async (request) => {
            events.push('backup');
            return formulaBackup(request);
          },
          batchUpdate: async (request) => {
            writeCalls += 1;
            if (writeCalls === 1) {
              events.push('write-failed');
              throw new Error('transport uncertainty');
            }
            events.push('rollback');
            assert.equal(request.requestBody.valueInputOption, 'USER_ENTERED');
            return { data: {} };
          }
        }
      }
    },
    writesEnabled: true
  });

  await assert.rejects(() => sync({ dryRun: false }), /decision state write failed; rollback restored/);
  assert.deepEqual(events, ['backup', 'write-failed', 'rollback']);
});

test('rollback failure is surfaced explicitly and can never look like a successful sync', async () => {
  let shadowRuns = 0;
  let batchCalls = 0;
  const sync = createDecisionStateSynchronizer({
    spreadsheetId: 'sheet-1',
    runShadow: async () => {
      shadowRuns += 1;
      if (shadowRuns === 1) return { comparison: matchingComparison() };
      return { comparison: { total: 2, matches: 1, mismatches: [{ ruleId: 'DEC-EST-ADJ' }], results: [] } };
    },
    sheets: {
      spreadsheets: {
        values: {
          batchGet: async (request) => formulaBackup(request),
          batchUpdate: async () => {
            batchCalls += 1;
            if (batchCalls === 2) throw new Error('rollback transport failure');
            return { data: {} };
          }
        }
      }
    },
    writesEnabled: true
  });

  await assert.rejects(() => sync({ dryRun: false }), /post-write shadow verification failed and rollback failed/);
  assert.equal(batchCalls, 2);
});
