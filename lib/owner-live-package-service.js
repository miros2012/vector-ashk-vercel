import { buildConfiguredCashScenarioForecast } from './configured-cash-scenario-policy.js';
import { calculateSafeWithdrawal } from './safe-withdrawal-policy.js';
import { buildOwnerActionAgenda } from './owner-action-agenda.js';
import { buildDecisionVerificationQueue } from './decision-verification-queue.js';
import { createOwnerDashboardSnapshot } from './owner-dashboard-snapshot.js';
import {
  VECTOR_OWNER_CASH_CONFIGURATIONS,
  VECTOR_OWNER_CASH_POLICY
} from './vector-owner-cash-policy.js';

const SHEETS_EPOCH_UTC = Date.UTC(1899, 11, 30);
const MODEL_VERSION = 'owner-live-v1';
const OPERATING_RESERVE_UNDEFINED = 'OPERATING_RESERVE_UNDEFINED';
const UNCONFIRMED_AMOUNT_MISSING = 'UNCONFIRMED_OBLIGATION_AMOUNT_MISSING';

function text(value) {
  return String(value ?? '').trim();
}

function normalizeZero(value) {
  return Object.is(value, -0) ? 0 : value;
}

function nonNegativeNumber(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${field} must be finite`);
  }
  const normalized = normalizeZero(value);
  if (normalized < 0) throw new Error(`${field} must be non-negative`);
  return normalized;
}

function isoTimestamp(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || !/[zZ]|[+-]\d{2}:\d{2}$/.test(value.trim())) {
    throw new Error(`${field} must be a valid ISO timestamp`);
  }
  return parsed.toISOString();
}

function strictBusinessDate(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${field} must be a valid YYYY-MM-DD date`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${field} must be a valid YYYY-MM-DD date`);
  }
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function healthFacts(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('facts.dataHealth is required');
  }
  const status = text(value.status).toUpperCase();
  if (!['OK', 'WARNING', 'BLOCKED'].includes(status)) {
    throw new Error('facts.dataHealth.status is unsupported');
  }
  if (typeof value.ok !== 'boolean') throw new Error('facts.dataHealth.ok must be boolean');
  if (value.ok && status === 'BLOCKED') throw new Error('blocked Data Health cannot be ok');
  if (!value.ok && status !== 'BLOCKED') throw new Error('non-ok Data Health must be blocked');

  const reasons = [];
  const seen = new Set();
  const addReason = reason => {
    const normalized = text(reason);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    reasons.push(normalized);
  };
  for (const reason of Array.isArray(value.consistencyErrors) ? value.consistencyErrors : []) addReason(reason);
  for (const source of Array.isArray(value.staleCoreSources) ? value.staleCoreSources : []) {
    addReason(`source-stale:${text(source)}`);
  }
  for (const source of Array.isArray(value.missingCoreSources) ? value.missingCoreSources : []) {
    addReason(`source-missing:${text(source)}`);
  }
  for (const warning of Array.isArray(value.warnings) ? value.warnings : []) addReason(warning);

  if (status !== 'OK' && reasons.length === 0) {
    throw new Error('non-OK Data Health requires at least one reason');
  }
  return { status, reasons };
}

function businessDateFromSheetValue(value, field) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const timestamp = SHEETS_EPOCH_UTC + Math.trunc(value) * 86400000;
    return new Date(timestamp).toISOString().slice(0, 10);
  }
  const source = text(value);
  const iso = source.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return strictBusinessDate(iso[1], field);
  const ru = source.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (ru) return strictBusinessDate(`${ru[3]}-${ru[2]}-${ru[1]}`, field);
  throw new Error(`${field} must contain a business date`);
}

function endOfBusinessDay(value, field) {
  const date = businessDateFromSheetValue(value, field);
  return new Date(`${date}T23:59:59+05:00`).toISOString();
}

function baseScenario(cashScenario) {
  const scenario = cashScenario.forecast.scenarios.find(item => item.name === 'base');
  if (!scenario) throw new Error('base cash scenario is unavailable');
  return scenario;
}

function buildAgendaCandidates({ facts, cashScenario, health, generatedAt }) {
  const candidates = [];
  const salesDeficit = Math.max(0, facts.sales.planToDate - facts.sales.monthFact);
  if (salesDeficit > 0) {
    candidates.push({
      id: `LIVE-SALES-COLLECTION-${facts.businessDate}`,
      category: 'SALES_COLLECTION',
      priority: 'HIGH',
      deadline: endOfBusinessDay(facts.businessDate, 'facts.businessDate'),
      amount: salesDeficit,
      responsible: 'РОП',
      action: 'Закрыть дефицит продаж и сбора к плану на дату',
      blocking: false,
      financialExecution: false
    });
  }

  const base = baseScenario(cashScenario);
  if (base.cashGap > 0) {
    candidates.push({
      id: `LIVE-LIQUIDITY-${facts.businessDate}`,
      category: 'LIQUIDITY',
      priority: 'CRITICAL',
      deadline: endOfBusinessDay(base.minimumBalanceDate, 'base.minimumBalanceDate'),
      amount: base.cashGap,
      responsible: 'Собственник',
      action: 'Закрыть прогнозный кассовый разрыв',
      blocking: true,
      financialExecution: false
    });
  }

  for (const obligation of facts.obligations.rows) {
    if (obligation.closed || obligation.unconfirmed || obligation.cashNeed <= 0) continue;
    candidates.push({
      id: `LIVE-OBLIGATION-${obligation.id}`,
      category: 'CRITICAL_OBLIGATION',
      priority: 'CRITICAL',
      deadline: endOfBusinessDay(obligation.dueDate, `obligation ${obligation.id} dueDate`),
      amount: obligation.cashNeed,
      responsible: 'Собственник',
      action: `Обеспечить исполнение обязательства: ${obligation.name || obligation.id}`,
      blocking: true,
      financialExecution: true
    });
  }

  if (health.status === 'BLOCKED') {
    candidates.push({
      id: `LIVE-DATA-HEALTH-${facts.businessDate}`,
      category: 'DATA_HEALTH',
      priority: 'CRITICAL',
      deadline: generatedAt,
      amount: 0,
      responsible: 'Собственник',
      action: 'Восстановить достоверность финансовых источников и учётное покрытие',
      blocking: true,
      financialExecution: false
    });
  }

  return candidates;
}

function snapshotActionsFromAgenda(agenda) {
  return agenda.actions.map(item => ({
    id: item.id,
    priority: item.priority.toLowerCase(),
    responsible: item.responsible,
    deadline: item.deadline,
    riskEffectAmount: item.amount
  }));
}

function policyBlockers({ operatingReserveDefined, unconfirmedAmountMissing }) {
  const blockers = [];
  if (!operatingReserveDefined) blockers.push(OPERATING_RESERVE_UNDEFINED);
  if (unconfirmedAmountMissing) blockers.push(UNCONFIRMED_AMOUNT_MISSING);
  return blockers;
}

function gatedWithdrawal({
  facts,
  cashScenario,
  health,
  blockers,
  operatingReserveDefined,
  operatingReserve
}) {
  const protectedComponents = {
    confirmedObligations: facts.obligations.confirmedCashNeed,
    drivingFundDeficit: Math.max(0, facts.drivingFund.deficit)
  };
  if (!facts.obligations.unconfirmedAmountMissing) {
    protectedComponents.unconfirmedObligationReserve = facts.obligations.unconfirmedCashNeed;
  }
  if (operatingReserveDefined) protectedComponents.requiredOperatingReserve = operatingReserve;

  return deepFreeze({
    policyMode: VECTOR_OWNER_CASH_POLICY.policyMode,
    dataHealthStatus: health.status,
    blocked: true,
    reasons: health.status === 'BLOCKED' ? [...health.reasons] : [],
    policyBlockers: [...blockers],
    safeWithdrawal: 0,
    limits: {
      availableCash: facts.forecast.availableCash,
      protectedComponents,
      scenarioCaps: { ...cashScenario.scenarioCaps },
      requiredScenarioCaps: ['conservative', 'base', 'target']
    },
    bindingLimit: { id: 'POLICY_BLOCKER', amount: 0 },
    explanation: {
      policyMode: VECTOR_OWNER_CASH_POLICY.policyMode,
      calculation: 'POLICY_BLOCKED'
    }
  });
}

function ordinaryWithdrawal({ facts, cashScenario, health, operatingReserve }) {
  const withdrawalHealthStatus = health.status === 'BLOCKED' ? 'BLOCKED' : 'OK';
  const core = calculateSafeWithdrawal({
    availableCash: facts.forecast.availableCash,
    confirmedObligations: facts.obligations.confirmedCashNeed,
    unconfirmedObligationReserve: facts.obligations.unconfirmedCashNeed,
    requiredOperatingReserve: operatingReserve,
    drivingFundDeficit: Math.max(0, facts.drivingFund.deficit),
    scenarioCaps: cashScenario.scenarioCaps,
    dataHealthStatus: withdrawalHealthStatus,
    blockingReasons: withdrawalHealthStatus === 'BLOCKED' ? health.reasons : [],
    policyMode: VECTOR_OWNER_CASH_POLICY.policyMode
  });
  return deepFreeze({ ...core, policyBlockers: [] });
}

export function buildOwnerLivePackage(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('input is required');
  }
  const facts = input.facts;
  if (!facts || typeof facts !== 'object' || Array.isArray(facts)) {
    throw new Error('facts are required');
  }
  const generatedAt = isoTimestamp(input.generatedAt, 'generatedAt');
  const businessDate = strictBusinessDate(facts.businessDate, 'facts.businessDate');
  const health = healthFacts(facts.dataHealth);

  const cashScenario = buildConfiguredCashScenarioForecast({
    configurations: VECTOR_OWNER_CASH_CONFIGURATIONS,
    asOf: generatedAt,
    openingCash: facts.forecast.openingCash,
    flows: facts.forecast.flows,
    protectedReserves: facts.forecast.protectedReserves
  });

  const operatingReserveDefined = input.operatingReserve !== undefined;
  const operatingReserve = operatingReserveDefined
    ? nonNegativeNumber(input.operatingReserve, 'operatingReserve')
    : null;
  const blockers = policyBlockers({
    operatingReserveDefined,
    unconfirmedAmountMissing: facts.obligations.unconfirmedAmountMissing === true
  });

  const withdrawal = blockers.length
    ? gatedWithdrawal({
        facts,
        cashScenario,
        health,
        blockers,
        operatingReserveDefined,
        operatingReserve
      })
    : ordinaryWithdrawal({ facts, cashScenario, health, operatingReserve });

  const verificationQueue = buildDecisionVerificationQueue({
    decisions: facts.decisions,
    history: facts.history,
    now: generatedAt,
    verificationSlaHours: nonNegativeNumber(
      input.verificationSlaHours,
      'verificationSlaHours'
    )
  });

  const agenda = buildOwnerActionAgenda({
    asOf: generatedAt,
    dataHealthStatus: health.status === 'BLOCKED' ? 'BLOCKED' : 'OK',
    candidates: buildAgendaCandidates({
      facts,
      cashScenario,
      health,
      generatedAt
    })
  });

  const base = baseScenario(cashScenario);
  const snapshot = createOwnerDashboardSnapshot({
    snapshotId: `OWNER-LIVE-${businessDate}`,
    businessDate,
    generatedAt,
    modelVersion: MODEL_VERSION,
    availableCash: nonNegativeNumber(facts.forecast.availableCash, 'facts.forecast.availableCash'),
    cashGap: nonNegativeNumber(base.cashGap, 'base.cashGap'),
    safeWithdrawal: withdrawal.safeWithdrawal,
    salesPlanToDate: nonNegativeNumber(facts.sales.planToDate, 'facts.sales.planToDate'),
    salesFact: nonNegativeNumber(facts.sales.monthFact, 'facts.sales.monthFact'),
    receivables: nonNegativeNumber(facts.receivables.debt, 'facts.receivables.debt'),
    openObligations: nonNegativeNumber(facts.obligations.openCashNeed, 'facts.obligations.openCashNeed'),
    unconfirmedObligations: nonNegativeNumber(
      facts.obligations.unconfirmedCashNeed,
      'facts.obligations.unconfirmedCashNeed'
    ),
    drivingFundReserve: nonNegativeNumber(
      facts.drivingFund.requiredReserve,
      'facts.drivingFund.requiredReserve'
    ),
    drivingFundDeficit: Math.max(0, facts.drivingFund.deficit),
    dataHealth: {
      status: health.status,
      reasons: health.reasons
    },
    actions: snapshotActionsFromAgenda(agenda)
  });

  const policy = {
    operatingReserve: {
      defined: operatingReserveDefined,
      amount: operatingReserve
    },
    blockers: [...blockers]
  };
  const summary = {
    safeWithdrawal: withdrawal.safeWithdrawal,
    selectedActionCount: agenda.actions.length,
    pendingVerificationCount: verificationQueue.total,
    overdueVerificationCount: verificationQueue.overdueCount
  };

  return deepFreeze({
    policy,
    cashScenario,
    withdrawal,
    agenda,
    verificationQueue,
    snapshot,
    summary
  });
}
