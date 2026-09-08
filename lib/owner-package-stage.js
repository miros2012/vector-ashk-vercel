const STAGES = [
  'FORECAST_READ',
  'BATCH_READ',
  'MATRICES_PARSE',
  'DATA_HEALTH_PARSE',
  'SALES_PARSE',
  'RECEIVABLES_PARSE',
  'OBLIGATIONS_PARSE',
  'DRIVING_FUND_PARSE',
  'DECISIONS_PARSE',
  'HISTORY_PARSE',
  'PACKAGE_BUILD',
  'UNCLASSIFIED'
];

export const OWNER_PACKAGE_STAGES = Object.freeze([...STAGES]);
const STAGE_SET = new Set(OWNER_PACKAGE_STAGES);

function safeStage(value) {
  return STAGE_SET.has(value) ? value : 'UNCLASSIFIED';
}

class OwnerPackageStageError extends Error {
  constructor(stage) {
    super('owner package stage failed');
    this.name = 'OwnerPackageStageError';
    this.stage = safeStage(stage);
  }
}

export async function runOwnerPackageStage(stage, operation) {
  if (typeof operation !== 'function') {
    throw new OwnerPackageStageError('UNCLASSIFIED');
  }
  try {
    return await operation();
  } catch {
    throw new OwnerPackageStageError(stage);
  }
}

export function ownerPackageFailureStage(error) {
  if (!(error instanceof OwnerPackageStageError)) return 'UNCLASSIFIED';
  return safeStage(error.stage);
}
