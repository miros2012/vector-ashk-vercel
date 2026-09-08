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
const ERROR_STAGES = new WeakMap();

function safeStage(value) {
  return STAGE_SET.has(value) ? value : 'UNCLASSIFIED';
}

function isObjectLike(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function');
}

function taggedFallbackError(stage) {
  const error = new Error('owner package stage failed');
  error.name = 'OwnerPackageStageError';
  ERROR_STAGES.set(error, safeStage(stage));
  return error;
}

export async function runOwnerPackageStage(stage, operation) {
  if (typeof operation !== 'function') {
    throw taggedFallbackError('UNCLASSIFIED');
  }
  try {
    return await operation();
  } catch (error) {
    if (isObjectLike(error)) {
      if (!ERROR_STAGES.has(error)) ERROR_STAGES.set(error, safeStage(stage));
      throw error;
    }
    throw taggedFallbackError(stage);
  }
}

export function ownerPackageFailureStage(error) {
  if (!isObjectLike(error)) return 'UNCLASSIFIED';
  return safeStage(ERROR_STAGES.get(error));
}
