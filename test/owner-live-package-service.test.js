import test from 'node:test';
import assert from 'node:assert/strict';

async function loadLiveService() {
  try {
    const module = await import('../lib/owner-live-package-service.js');
    return module.buildOwnerLivePackage;
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') return undefined;
    throw error;
  }
}

async function loadForecastStage() {
  const module = await import('../lib/configured-cash-scenario-policy.js');
  return module.buildConfiguredCashScenarioForecast;
}

function liveFacts(overrides = {}) {
  return {
    businessDate: '2026-09-07',
    forecast: {
      availableCash: 1_000_000,
      openingCash: 1_000_000,
      flows: [
        { date: '2026-09-08', inflow: 100_000, outflow: 100_000 }
      ],
      protectedReserves: [
        { date: '2026-09-08', amount: 0 }
      ]
    },
    dataHealth: {
      ok: true,
      status: 'OK',
      staleCoreSources: [],
      missingCoreSources: [],
      warnings: [],
      consistencyErrors: []
    },
    sales: {
      monthlyPlan: 1_000_000,
      planToDate: 500_000,
      dayFact: 10_000,
      monthFact: 400_000
    },
    receivables: {
      contracts: 10,
      debt: 300_000,
      sales: 1_000_000,
      paid: 700_000
    },
    obligations: {
      rows: [
        {
          id: 'OBL-1',
          dueDate: 46273,
          name: 'Лизинг',
          category: 'Кредиты / лизинг',
          status: 'Прогноз',
          source: 'История ДДС',
          confidence: 'Среднее',
          closed: false,
          unconfirmed: false,
          netCashOutflow: 100_000,
          cashNeed: 100_000
        },
        {
          id: 'OBL-2',
          dueDate: 46274,
          name: 'Оценка',
          category: 'Прочее',
          status: 'Требует подтверждения',
          source: 'Ручной источник',
          confidence: 'Низкое',
          closed: false,
          unconfirmed: true,
          netCashOutflow: 50_000,
          cashNeed: 50_000
        }
      ],
      adjustments: [],
      openCashNeed: 150_000,
      confirmedCashNeed: 100_000,
      unconfirmedCashNeed: 50_000,
      unconfirmedAmountMissing: false
    },
    drivingFund: {
      requiredReserve: 500_000,
      liveBalance: 300_000,
      deficit: 200_000
    },
    decisions: [
      {
        ruleId: 'DEC-1',
        ruleStatus: 'Активно',
        executionStatus: 'Готово',
        plannedEffect: 50_000,
        actualEffect: null,
        startedAt: '2026-09-05T05:00:00.000Z',
        completedAt: '2026-09-06T05:00:00.000Z',
        result: '',
        verificationStatus: 'Не проверено',
        lastCheckedAt: null,
        responsible: 'Собственник',
        source: 'Decision Engine',
        linkedObject: null,
        synthetic: false,
        _row: 2
      }
    ],
    history: [],
    ...overrides
  };
}

function serviceInput(overrides = {}) {
  return {
    facts: liveFacts(),
    generatedAt: '2026-09-07T10:00:00.000Z',
    verificationSlaHours: 24,
    ...overrides
  };
}

test('exposes a configured scenario forecast stage that does not require an operating reserve', async () => {
  const buildConfiguredCashScenarioForecast = await loadForecastStage();
  assert.equal(typeof buildConfiguredCashScenarioForecast, 'function');

  const { VECTOR_OWNER_CASH_CONFIGURATIONS } = await import('../lib/vector-owner-cash-policy.js');
  const result = buildConfiguredCashScenarioForecast({
    configurations: VECTOR_OWNER_CASH_CONFIGURATIONS,
    asOf: '2026-09-07T10:00:00.000Z',
    openingCash: 1_000_000,
    flows: [{ date: '2026-09-08', inflow: 100_000, outflow: 100_000 }],
    protectedReserves: [{ date: '2026-09-08', amount: 0 }]
  });

  assert.equal(result.configuration.configurationId, 'vector-owner-cash-policy');
  assert.deepEqual(result.scenarioCaps, {
    conservative: 680_000,
    base: 700_000,
    target: 713_000
  });
  assert.equal(Object.hasOwn(result, 'withdrawal'), false);
});

test('returns the live package while undefined operating reserve forces safe withdrawal to zero', async () => {
  const buildOwnerLivePackage = await loadLiveService();
  assert.equal(typeof buildOwnerLivePackage, 'function');

  const input = serviceInput();
  const before = structuredClone(input);
  const result = buildOwnerLivePackage(input);

  assert.equal(result.withdrawal.safeWithdrawal, 0);
  assert.deepEqual(result.withdrawal.policyBlockers, ['OPERATING_RESERVE_UNDEFINED']);
  assert.deepEqual(result.policy, {
    operatingReserve: { defined: false, amount: null },
    blockers: ['OPERATING_RESERVE_UNDEFINED']
  });
  assert.equal(result.snapshot.dataHealth.status, 'OK');
  assert.equal(result.snapshot.safeWithdrawal, 0);
  assert.equal(result.snapshot.availableCash, 1_000_000);
  assert.equal(result.snapshot.salesPlanToDate, 500_000);
  assert.equal(result.snapshot.salesFact, 400_000);
  assert.equal(result.snapshot.receivables, 300_000);
  assert.equal(result.snapshot.openObligations, 150_000);
  assert.equal(result.snapshot.unconfirmedObligations, 50_000);
  assert.equal(result.snapshot.drivingFundReserve, 500_000);
  assert.equal(result.snapshot.drivingFundDeficit, 200_000);
  assert.equal(result.cashScenario.forecast.scenarios.length, 3);
  assert.equal(result.verificationQueue.total, 1);
  assert.equal(JSON.stringify(result.withdrawal).includes('requiredOperatingReserve'), false);
  assert.deepEqual(input, before);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.policy), true);
  assert.equal(Object.isFrozen(result.cashScenario), true);
});

test('uses the existing safe-withdrawal core when an explicit operating reserve is supplied', async () => {
  const buildOwnerLivePackage = await loadLiveService();
  const result = buildOwnerLivePackage(serviceInput({ operatingReserve: 100_000 }));

  assert.equal(result.withdrawal.safeWithdrawal, 550_000);
  assert.deepEqual(result.withdrawal.policyBlockers, []);
  assert.equal(result.withdrawal.limits.protectedComponents.requiredOperatingReserve, 100_000);
  assert.deepEqual(result.policy, {
    operatingReserve: { defined: true, amount: 100_000 },
    blockers: []
  });
});

test('keeps canonical Data Health separate from policy incompleteness and blocks financial agenda execution only when Data Health is blocked', async () => {
  const buildOwnerLivePackage = await loadLiveService();
  const facts = liveFacts({
    dataHealth: {
      ok: false,
      status: 'BLOCKED',
      staleCoreSources: [],
      missingCoreSources: [],
      warnings: [],
      consistencyErrors: ['tochka dds coverage incomplete']
    }
  });
  const result = buildOwnerLivePackage(serviceInput({ facts, operatingReserve: 100_000 }));

  assert.equal(result.snapshot.dataHealth.status, 'BLOCKED');
  assert.deepEqual(result.snapshot.dataHealth.reasons, ['tochka dds coverage incomplete']);
  assert.equal(result.withdrawal.safeWithdrawal, 0);
  assert.deepEqual(result.withdrawal.policyBlockers, []);
  assert.equal(result.withdrawal.bindingLimit.id, 'DATA_HEALTH');

  const obligationAction = result.agenda.actions.find(item => item.category === 'CRITICAL_OBLIGATION');
  assert.equal(obligationAction.financialExecution, true);
  assert.equal(obligationAction.executable, false);
  assert.equal(obligationAction.nonExecutableReason, 'DATA_HEALTH_BLOCKED');
});

test('missing unconfirmed obligation amount blocks withdrawal rather than inventing a reserve', async () => {
  const buildOwnerLivePackage = await loadLiveService();
  const facts = liveFacts({
    obligations: {
      ...liveFacts().obligations,
      openCashNeed: 100_000,
      unconfirmedCashNeed: 0,
      unconfirmedAmountMissing: true
    }
  });
  const result = buildOwnerLivePackage(serviceInput({ facts, operatingReserve: 100_000 }));

  assert.equal(result.withdrawal.safeWithdrawal, 0);
  assert.deepEqual(result.withdrawal.policyBlockers, ['UNCONFIRMED_OBLIGATION_AMOUNT_MISSING']);
  assert.equal(JSON.stringify(result.withdrawal).includes('unconfirmedObligationReserve'), false);
});

test('warning Data Health remains visible without being rewritten into a policy blocker', async () => {
  const buildOwnerLivePackage = await loadLiveService();
  const facts = liveFacts({
    dataHealth: {
      ok: true,
      status: 'WARNING',
      staleCoreSources: [],
      missingCoreSources: [],
      warnings: ['source-delay:payments'],
      consistencyErrors: []
    }
  });
  const result = buildOwnerLivePackage(serviceInput({ facts, operatingReserve: 100_000 }));

  assert.equal(result.snapshot.dataHealth.status, 'WARNING');
  assert.deepEqual(result.snapshot.dataHealth.reasons, ['source-delay:payments']);
  assert.equal(result.withdrawal.safeWithdrawal, 550_000);
  assert.deepEqual(result.withdrawal.policyBlockers, []);
});
