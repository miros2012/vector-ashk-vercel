import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOwnerReadonlyPackage } from '../lib/owner-readonly-package.js';

function baseInput() {
  return {
    withdrawalInput: {
      policyMode: 'BASE',
      dataHealthStatus: 'OK',
      blockingReasons: [],
      availableCash: 100000,
      confirmedObligations: 10000,
      unconfirmedObligationReserve: 5000,
      requiredOperatingReserve: 10000,
      drivingFundDeficit: 5000,
      scenarioCaps: {
        conservative: 20000,
        base: 30000,
        target: 40000
      }
    },
    agendaInput: {
      asOf: '2026-09-06T12:00:00.000Z',
      dataHealthStatus: 'OK',
      candidates: [
        {
          id: 'collect-cash',
          category: 'LIQUIDITY',
          priority: 'CRITICAL',
          deadline: '2026-09-06T13:00:00.000Z',
          amount: 50000,
          responsible: 'Owner',
          action: 'Collect cash',
          blocking: true,
          financialExecution: false
        },
        {
          id: 'verify-decision',
          category: 'DECISION_VERIFICATION',
          priority: 'HIGH',
          deadline: '2026-09-07T12:00:00.000Z',
          amount: 5000,
          responsible: 'Owner',
          action: 'Verify effect',
          blocking: false,
          financialExecution: false
        }
      ]
    },
    verificationInput: {
      decisions: [
        {
          ruleId: 'decision-1',
          executionStatus: 'Готово',
          verificationStatus: 'Не проверено',
          plannedEffect: 5000,
          responsible: 'Owner',
          completedAt: '2026-09-05T06:00:00.000Z',
          synthetic: false
        }
      ],
      history: [],
      now: '2026-09-06T12:00:00.000Z',
      verificationSlaHours: 24
    },
    snapshotInput: {
      snapshotId: 'owner-2026-09-06',
      businessDate: '2026-09-06',
      generatedAt: '2026-09-06T12:00:00.000Z',
      modelVersion: 'owner-readonly-v1',
      availableCash: 100000,
      cashGap: 0,
      salesPlanToDate: 300000,
      salesFact: 280000,
      receivables: 500000,
      openObligations: 250000,
      unconfirmedObligations: 10000,
      drivingFundReserve: 100000,
      drivingFundDeficit: 5000,
      dataHealth: {
        status: 'OK',
        reasons: []
      }
    }
  };
}

test('composes existing owner cores into one immutable read-only package', () => {
  const input = baseInput();
  const result = buildOwnerReadonlyPackage(input);

  assert.equal(result.withdrawal.safeWithdrawal, 30000);
  assert.equal(result.agenda.actions.length, 2);
  assert.equal(result.verificationQueue.total, 1);
  assert.equal(result.verificationQueue.overdueCount, 1);
  assert.equal(result.snapshot.safeWithdrawal, 30000);
  assert.match(result.snapshot.fingerprint, /^[a-f0-9]{64}$/);
  assert.deepEqual(result.summary, {
    safeWithdrawal: 30000,
    selectedActionCount: 2,
    pendingVerificationCount: 1,
    overdueVerificationCount: 1
  });
});

test('adapts selected agenda actions mechanically into dashboard snapshot actions', () => {
  const result = buildOwnerReadonlyPackage(baseInput());

  assert.deepEqual(result.snapshot.actions, [
    {
      id: 'collect-cash',
      priority: 'critical',
      responsible: 'Owner',
      deadline: '2026-09-06T13:00:00.000Z',
      riskEffectAmount: 50000
    },
    {
      id: 'verify-decision',
      priority: 'high',
      responsible: 'Owner',
      deadline: '2026-09-07T12:00:00.000Z',
      riskEffectAmount: 5000
    }
  ]);
});

test('propagates blocked safe withdrawal without inventing another Data Health rule', () => {
  const input = baseInput();
  input.withdrawalInput.dataHealthStatus = 'BLOCKED';
  input.withdrawalInput.blockingReasons = ['DDS incomplete'];
  input.agendaInput.dataHealthStatus = 'BLOCKED';
  input.snapshotInput.dataHealth = {
    status: 'BLOCKED',
    reasons: ['DDS incomplete']
  };

  const result = buildOwnerReadonlyPackage(input);

  assert.equal(result.withdrawal.safeWithdrawal, 0);
  assert.equal(result.summary.safeWithdrawal, 0);
  assert.equal(result.snapshot.safeWithdrawal, 0);
});

test('keeps the full verification queue separate from the top-three owner agenda', () => {
  const input = baseInput();
  input.verificationInput.decisions.push({
    ruleId: 'decision-2',
    executionStatus: 'Готово',
    verificationStatus: '',
    plannedEffect: 1000,
    responsible: 'CFO',
    completedAt: '2026-09-06T11:00:00.000Z',
    synthetic: false
  });

  const result = buildOwnerReadonlyPackage(input);

  assert.equal(result.agenda.actions.length, 2);
  assert.equal(result.verificationQueue.total, 2);
  assert.equal(result.summary.pendingVerificationCount, 2);
});

test('fails closed when dashboard derived fields are pre-supplied by the caller', () => {
  const withWithdrawal = baseInput();
  withWithdrawal.snapshotInput.safeWithdrawal = 1;
  assert.throws(
    () => buildOwnerReadonlyPackage(withWithdrawal),
    /snapshotInput\.safeWithdrawal.*must not be supplied/i
  );

  const withActions = baseInput();
  withActions.snapshotInput.actions = [];
  assert.throws(
    () => buildOwnerReadonlyPackage(withActions),
    /snapshotInput\.actions.*must not be supplied/i
  );
});

test('does not mutate inputs and deeply freezes the package', () => {
  const input = baseInput();
  const before = structuredClone(input);

  const result = buildOwnerReadonlyPackage(input);

  assert.deepEqual(input, before);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.summary), true);
  assert.equal(Object.isFrozen(result.snapshot), true);
  assert.equal(Object.isFrozen(result.agenda), true);
  assert.equal(Object.isFrozen(result.verificationQueue), true);
  assert.equal(Object.isFrozen(result.withdrawal), true);
  assert.throws(() => { result.summary.safeWithdrawal = 1; }, TypeError);
  assert.throws(() => { result.snapshot.actions.push({}); }, TypeError);
});
