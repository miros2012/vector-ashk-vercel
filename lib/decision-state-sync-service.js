import { buildDecisionStateUpdates } from './decision-state-sync.js';

function comparisonFrom(result) {
  const comparison = result?.comparison;
  if (!comparison || !Array.isArray(comparison.results)) {
    throw new Error('shadow comparison is required');
  }
  return comparison;
}

function backupDataFrom(response, updates) {
  const valueRanges = response?.data?.valueRanges || [];
  return updates.map((update, index) => ({
    range: update.range,
    values: valueRanges[index]?.values?.length ? valueRanges[index].values : [['']]
  }));
}

async function readFormulaBackup({ sheets, spreadsheetId, updates }) {
  if (!sheets?.spreadsheets?.values?.batchGet) {
    throw new Error('sheets batchGet is required for decision state writes');
  }
  const response = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: updates.map((update) => update.range),
    valueRenderOption: 'FORMULA'
  });
  return backupDataFrom(response, updates);
}

async function writeBatch({ sheets, spreadsheetId, data, valueInputOption }) {
  return sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption,
      data
    }
  });
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
    if (before.matches !== before.total || (before.mismatches?.length || 0) > 0) {
      throw new Error('pre-write shadow verification failed');
    }

    const backup = await readFormulaBackup({ sheets, spreadsheetId, updates });

    try {
      await writeBatch({ sheets, spreadsheetId, data: updates, valueInputOption: 'RAW' });
    } catch (error) {
      try {
        await writeBatch({ sheets, spreadsheetId, data: backup, valueInputOption: 'USER_ENTERED' });
      } catch (rollbackError) {
        throw new Error('decision state write failed and rollback failed', { cause: rollbackError });
      }
      throw new Error('decision state write failed; rollback restored', { cause: error });
    }

    const after = comparisonFrom(await runShadow());
    if (after.matches !== after.total || after.mismatches.length > 0) {
      try {
        await writeBatch({ sheets, spreadsheetId, data: backup, valueInputOption: 'USER_ENTERED' });
      } catch (rollbackError) {
        throw new Error('post-write shadow verification failed and rollback failed', { cause: rollbackError });
      }
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
