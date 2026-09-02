import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileMasterPayroll } from '../lib/master-payroll-reconciliation.js';

test('negative outstanding net is REVIEW_REQUIRED but does not block verified integration', () => {
  const result = reconcileMasterPayroll({
    gross: {
      archiveVerification: 'OK',
      eventBasedRulesOk: true,
      masters: [{ masterKey: 'a', masterName: 'A', gross: 10000 }],
      totals: { gross: 10000 },
      blockers: []
    },
    evidence: {
      confirmed: [{ masterKey: 'a', type: 'ADVANCE', amount: 12000, sourceId: 'x', status: 'CONFIRMED' }],
      blocked: [],
      existingPayoutsReconciled: false,
      vehicleAllocationsExcluded: true
    },
    requiredBlockedTypes: []
  });
  assert.equal(result.masters[0].status, 'REVIEW_REQUIRED');
  assert.equal(result.promotionStatus, 'VERIFIED_WITH_OPEN_REVIEW');
  assert.equal(result.gates.NO_UNEXPLAINED_NEGATIVE_NET, false);
});

test('unallocated fuel becomes OPEN_REVIEW without reducing net or blocking verified integration', () => {
  const blocked = [{ type: 'FUEL', amount: 3000, reason: 'NO_MASTER_ALLOCATION' }];
  const result = reconcileMasterPayroll({
    gross: {
      archiveVerification: 'OK',
      eventBasedRulesOk: true,
      masters: [{ masterKey: 'a', masterName: 'A', gross: 10000 }],
      totals: { gross: 10000 },
      blockers: []
    },
    evidence: { confirmed: [], blocked, existingPayoutsReconciled: false },
    requiredBlockedTypes: ['FUEL']
  });
  assert.equal(result.masters[0].outstandingNet, 10000);
  assert.equal(result.totals.blocked, 3000);
  assert.deepEqual(result.blocked, blocked);
  assert.equal(result.promotionStatus, 'VERIFIED_WITH_OPEN_REVIEW');
  assert.equal(result.gates.VEHICLE_ALLOCATIONS_RESOLVED_OR_EXCLUDED, false);
});

test('aggregate invariants use confirmed evidence only', () => {
  const result = reconcileMasterPayroll({
    gross: {
      archiveVerification: 'OK',
      eventBasedRulesOk: true,
      masters: [
        { masterKey: 'a', masterName: 'A', gross: 50000 },
        { masterKey: 'b', masterName: 'B', gross: 30000 }
      ],
      totals: { gross: 80000 },
      blockers: []
    },
    evidence: {
      confirmed: [
        { masterKey: 'a', type: 'ADVANCE', amount: 10000, sourceId: 'a1', status: 'CONFIRMED' },
        { masterKey: 'b', type: 'OFFICIAL_PAYMENT', amount: 5000, sourceId: 'b1', status: 'CONFIRMED' }
      ],
      blocked: [{ type: 'LEASING', amount: 9000, reason: 'NO_MASTER_ALLOCATION' }]
    },
    requiredBlockedTypes: []
  });
  assert.equal(result.totals.gross, 80000);
  assert.equal(result.totals.confirmedDeductions, 15000);
  assert.equal(result.totals.outstandingNet, 65000);
  assert.equal(result.totals.blocked, 9000);
  assert.equal(result.gates.PER_MASTER_EQUALS_AGGREGATE, true);
  assert.equal(result.gates.EVIDENCE_RECONCILED, true);
});

test('official settlement is counted once while a separate piecework advance remains separate', () => {
  const result = reconcileMasterPayroll({
    gross: {
      archiveVerification: 'OK',
      eventBasedRulesOk: true,
      masters: [{ masterKey: 'kozlov', masterName: 'Козлов', gross: 109100 }],
      totals: { gross: 109100 },
      blockers: []
    },
    evidence: {
      confirmed: [
        { masterKey: 'kozlov', type: 'ADVANCE', amount: 30000, sourceId: 'piecework-advance', status: 'CONFIRMED' },
        { masterKey: 'kozlov', type: 'ADVANCE', amount: 13166, sourceId: 'official-advance', status: 'CONFIRMED', settlementGroup: 'OFFICIAL_GROSS' },
        { masterKey: 'kozlov', type: 'STATUTORY_DEDUCTION', amount: 13583.35, sourceId: 'fssp-1', status: 'CONFIRMED', settlementGroup: 'OFFICIAL_GROSS' },
        { masterKey: 'kozlov', type: 'STATUTORY_DEDUCTION', amount: 6790.65, sourceId: 'fssp-2', status: 'CONFIRMED', settlementGroup: 'OFFICIAL_GROSS' }
      ],
      blocked: [],
      officialGrossByMaster: { kozlov: 32200 }
    },
    requiredBlockedTypes: []
  });

  assert.equal(result.masters[0].officialGrossSettled, 32200);
  assert.equal(result.masters[0].separateConfirmedDeductions, 30000);
  assert.equal(result.masters[0].confirmedDeductions, 62200);
  assert.equal(result.masters[0].outstandingNet, 46900);
});

test('READY still requires every review gate to be green', () => {
  const result = reconcileMasterPayroll({
    gross: {
      archiveVerification: 'OK',
      eventBasedRulesOk: true,
      masters: [{ masterKey: 'a', masterName: 'A', gross: 10000 }],
      totals: { gross: 10000 },
      blockers: []
    },
    evidence: {
      confirmed: [{ masterKey: 'a', type: 'ADVANCE', amount: 1000, sourceId: 'a1', status: 'CONFIRMED' }],
      blocked: [],
      existingPayoutsReconciled: true,
      vehicleAllocationsExcluded: true
    },
    requiredBlockedTypes: ['FUEL', 'LEASING']
  });
  assert.equal(result.masters[0].outstandingNet, 9000);
  assert.equal(result.masters[0].status, 'READY');
  assert.ok(Object.values(result.gates).every(Boolean));
  assert.equal(result.promotionStatus, 'READY');
});

test('gross aggregate mismatch remains a hard BLOCKED core failure', () => {
  const result = reconcileMasterPayroll({
    gross: {
      archiveVerification: 'OK',
      eventBasedRulesOk: true,
      masters: [{ masterKey: 'a', masterName: 'A', gross: 10000 }],
      totals: { gross: 9999 },
      blockers: []
    },
    evidence: { confirmed: [], blocked: [], existingPayoutsReconciled: true, vehicleAllocationsExcluded: true },
    requiredBlockedTypes: []
  });
  assert.equal(result.gates.PER_MASTER_EQUALS_AGGREGATE, false);
  assert.equal(result.promotionStatus, 'BLOCKED');
});

test('confirmed evidence for a master absent from verified gross remains a hard BLOCKED core failure', () => {
  const result = reconcileMasterPayroll({
    gross: {
      archiveVerification: 'OK',
      eventBasedRulesOk: true,
      masters: [{ masterKey: 'a', masterName: 'A', gross: 10000 }],
      totals: { gross: 10000 },
      blockers: []
    },
    evidence: {
      confirmed: [{ masterKey: 'missing-master', type: 'ADVANCE', amount: 1000, sourceId: 'm1', status: 'CONFIRMED' }],
      blocked: [],
      existingPayoutsReconciled: true,
      vehicleAllocationsExcluded: true
    },
    requiredBlockedTypes: []
  });

  assert.equal(result.gates.EVIDENCE_RECONCILED, false);
  assert.equal(result.promotionStatus, 'BLOCKED');
  assert.deepEqual(result.unmatchedEvidenceMasterKeys, ['missing-master']);
});
