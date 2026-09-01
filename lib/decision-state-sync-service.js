import { buildDecisionStateUpdates } from './decision-state-sync.js';

function comparisonFrom(result) {
  const comparison = result?.comparison;
  if (!comparison || !Array.isArray(comparison.results)) {
    throw new Error('shadow comparison is required');
  }
  return comparison;
}

export function createDecisionStateSynchronizer({
  spreadsheetId,
  runShadow,
  sheets,
  writesEnabled = false
} = {}) {
  if (!String(spreadsheetId || '').trim()) throw new Error('spreadsheetId is required');
  if (typeof runShadow !== 'function') throw new Error('runShadow is required');
  if (!sheets?.spreadsheets?.values?.batchUpdate) throw new Error('sheets batchUpdate is required');

  return async function synchronizeDecisionState({ dryRun = true } = {}) {
    const before = comparisonFrom(await runShadow());
    const updates = buildDecisionStateUpdates(before);

    if (dryRun) {
      return {
        ok: true,
        dryRun: true,
        total: before.total,
        matchesBefore: before.matches,
        writeCount: updates.length,
        verified: false
      };
    }

    if (!writesEnabled) throw new Error('decision state writes are disabled');

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'RAW',
        data: updates
      }
    });

    const after = comparisonFrom(await runShadow());
    if (after.matches !== after.total || after.mismatches.length > 0) {
      throw new Error('post-write shadow verification failed');
    }

    return {
      ok: true,
      dryRun: false,
      total: before.total,
      matchesBefore: before.matches,
      writeCount: updates.length,
      verified: true,
      matchesAfter: after.matches
    };
  };
}
