import { calculateSafeWithdrawal } from './safe-withdrawal-policy.js';
import { buildOwnerActionAgenda } from './owner-action-agenda.js';
import { buildDecisionVerificationQueue } from './decision-verification-queue.js';
import { createOwnerDashboardSnapshot } from './owner-dashboard-snapshot.js';

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function validateInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('input is required');
  }
  if (!input.snapshotInput || typeof input.snapshotInput !== 'object' || Array.isArray(input.snapshotInput)) {
    throw new Error('snapshotInput is required');
  }
  if (Object.prototype.hasOwnProperty.call(input.snapshotInput, 'safeWithdrawal')) {
    throw new Error('snapshotInput.safeWithdrawal must not be supplied');
  }
  if (Object.prototype.hasOwnProperty.call(input.snapshotInput, 'actions')) {
    throw new Error('snapshotInput.actions must not be supplied');
  }
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

export function buildOwnerReadonlyPackage(input) {
  validateInput(input);

  const withdrawal = calculateSafeWithdrawal(input.withdrawalInput);
  const agenda = buildOwnerActionAgenda(input.agendaInput);
  const verificationQueue = buildDecisionVerificationQueue(input.verificationInput);

  const snapshot = createOwnerDashboardSnapshot({
    ...input.snapshotInput,
    safeWithdrawal: withdrawal.safeWithdrawal,
    actions: snapshotActionsFromAgenda(agenda)
  });

  const summary = {
    safeWithdrawal: withdrawal.safeWithdrawal,
    selectedActionCount: agenda.actions.length,
    pendingVerificationCount: verificationQueue.total,
    overdueVerificationCount: verificationQueue.overdueCount
  };

  return deepFreeze({
    withdrawal,
    agenda,
    verificationQueue,
    snapshot,
    summary
  });
}
