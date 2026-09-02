import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calculateVerifiedGross, MASTER_PAYROLL_RATE_MODEL } from '../lib/master-payroll-gross.js';
import { normalizePayrollEvidence } from '../lib/master-payroll-evidence.js';
import { reconcileMasterPayroll } from '../lib/master-payroll-reconciliation.js';

const fixtureUrl = new URL('./fixtures/master-payroll-august-2026.json', import.meta.url);

function distributeHours(eventCount, totalHours) {
  const nominal = totalHours / eventCount;
  if (Number.isInteger(nominal)) return Array(eventCount).fill(nominal);

  const floor = Math.floor(nominal);
  const hours = Array(eventCount).fill(floor);
  let remaining = totalHours - floor * eventCount;
  let index = 0;
  while (remaining > 0) {
    const increment = Math.min(1, remaining);
    hours[index] += increment;
    remaining -= increment;
    index += 1;
  }
  return hours;
}

function expandVerifiedTypeControls(typeControls) {
  return typeControls.flatMap((control, typeIndex) => {
    const hours = control.hoursPerEvent ?? distributeHours(control.events, control.hours);
    assert.equal(hours.length, control.events);
    assert.equal(hours.reduce((sum, value) => sum + value, 0), control.hours);
    return hours.map((academicHours, index) => ({
      employeeId: `archive-control-${typeIndex + 1}`,
      masterName: `Archive control ${typeIndex + 1}`,
      sessionTypeName: control.sessionTypeName,
      academicHours,
      eventKey: `2026-08:${typeIndex + 1}:${index + 1}`
    }));
  });
}

function grossByGroup(result, group) {
  return result.masters.reduce((total, master) => total + Object.values(master.components ?? {})
    .filter((component) => component.group === group)
    .reduce((sum, component) => sum + component.gross, 0), 0);
}

test('August 2026 archive regression locks verified event counts, hours and full gross', async () => {
  const fixture = JSON.parse(await readFile(fixtureUrl, 'utf8'));
  const rows = expandVerifiedTypeControls(fixture.typeControls);

  assert.equal(rows.length, fixture.archive.rows);
  assert.equal(rows.reduce((sum, row) => sum + row.academicHours, 0), fixture.archive.hours);
  assert.equal(fixture.archive.verification, 'OK');
  assert.equal(fixture.archive.businessTimezone, 'Asia/Yekaterinburg');

  const gross = calculateVerifiedGross(rows, MASTER_PAYROLL_RATE_MODEL);
  const bGross = grossByGroup(gross, 'B');
  const motoGross = grossByGroup(gross, 'MOTO');
  const extraMotoGross = grossByGroup(gross, 'EXTRA_MOTO');
  const trainerGross = grossByGroup(gross, 'TRAINER');

  assert.equal(bGross, fixture.expected.bGrossEventBased);
  assert.equal(bGross - fixture.expected.previousHourBasedBControl, 1000);
  assert.equal(motoGross, fixture.expected.motoGross);
  assert.equal(extraMotoGross, fixture.expected.extraMotoGross);
  assert.equal(trainerGross, fixture.expected.trainerGross);
  assert.equal(gross.totals.gross, fixture.expected.fullGross);
  assert.equal(gross.masters.reduce((sum, master) => sum + master.gross, 0), gross.totals.gross);
});

test('August evidence registry totals 175,922 RUB and vehicle costs stay blocked', async () => {
  const fixture = JSON.parse(await readFile(fixtureUrl, 'utf8'));
  const evidence = normalizePayrollEvidence(
    [...fixture.confirmedEvidence, ...fixture.blockedVehicleEvidence],
    fixture.aliases
  );

  assert.equal(evidence.confirmed.reduce((sum, item) => sum + item.amount, 0), fixture.expected.confirmedEvidenceTotal);
  assert.ok(evidence.blocked.some((item) => item.type === 'FUEL'));
  assert.ok(evidence.blocked.some((item) => item.type === 'LEASING'));
});

test('verified controls preserve the two event-count anomalies that invalidate hour-only payroll', async () => {
  const fixture = JSON.parse(await readFile(fixtureUrl, 'utf8'));
  const extraB = fixture.typeControls.find((item) => item.sessionTypeName === 'Доп. часы кат В (120 минут)');
  const exams = fixture.typeControls.find((item) => item.sessionTypeName === 'Внутренний экзамен город');

  assert.deepEqual([extraB.events, extraB.hours], [521, 1561]);
  assert.deepEqual([exams.events, exams.hours], [188, 189]);
  assert.equal(extraB.events * 1500, 781500);
  assert.equal(exams.events * 200, 37600);
});

test('evidence-linked August masters reconcile by real EmployeeId with no silent unmatched payments', async () => {
  const fixture = JSON.parse(await readFile(fixtureUrl, 'utf8'));
  const evidence = normalizePayrollEvidence(fixture.confirmedEvidence, fixture.aliases);
  const grossTotal = fixture.verifiedMasterControls.reduce((sum, master) => sum + master.gross, 0);
  const result = reconcileMasterPayroll({
    gross: {
      archiveVerification: 'OK',
      eventBasedRulesOk: true,
      blockers: [],
      masters: fixture.verifiedMasterControls,
      totals: { gross: grossTotal }
    },
    evidence: {
      ...evidence,
      existingPayoutsReconciled: false,
      vehicleAllocationsExcluded: false
    },
    requiredBlockedTypes: []
  });

  assert.equal(grossTotal, fixture.expected.evidenceLinkedGross);
  assert.equal(result.totals.confirmedDeductions, fixture.expected.confirmedEvidenceTotal);
  assert.equal(result.totals.outstandingNet, fixture.expected.evidenceLinkedOutstanding);
  assert.deepEqual(result.unmatchedEvidenceMasterKeys, []);
  assert.equal(result.gates.EVIDENCE_RECONCILED, true);

  const atalykov = result.masters.find((master) => master.masterKey === '2859064');
  const tolstoukhov = result.masters.find((master) => master.masterKey === '2064915');
  assert.equal(atalykov.outstandingNet, -14299);
  assert.equal(atalykov.status, 'REVIEW_REQUIRED');
  assert.equal(tolstoukhov.outstandingNet, 130186);
});
