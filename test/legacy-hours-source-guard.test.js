import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const legacyDiagnosticPath = fileURLToPath(new URL('../diagnostic-build.js', import.meta.url));
const syncHoursPath = fileURLToPath(new URL('../api/sync-hours.js', import.meta.url));

test('legacy DriveWalletOperationList HOURS diagnostic is absent', () => {
  assert.equal(
    existsSync(legacyDiagnosticPath),
    false,
    'diagnostic-build.js must stay removed so legacy DriveWalletOperationList cannot be mistaken for canonical HOURS'
  );
});

test('production HOURS sync stays on MasterWorkReportDetails', () => {
  const source = readFileSync(syncHoursPath, 'utf8');
  assert.match(source, /MasterWorkReportDetails/);
  assert.doesNotMatch(source, /DriveWalletOperationList/);
});
