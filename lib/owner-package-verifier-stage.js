export const OWNER_PACKAGE_VERIFIER_STAGES = Object.freeze([
  'CACHE_CONTROL',
  'BODY_SHAPE',
  'SAFE_WITHDRAWAL',
  'POLICY',
  'BUSINESS_DATE',
  'FRESHNESS'
]);

const APPROVED_STAGES = new Set(OWNER_PACKAGE_VERIFIER_STAGES);
const stageByError = new WeakMap();

function approvedStage(value) {
  const stage = String(value || '').trim();
  return APPROVED_STAGES.has(stage) ? stage : 'UNCLASSIFIED';
}

function tagError(error, stage) {
  if (error && (typeof error === 'object' || typeof error === 'function')) {
    stageByError.set(error, approvedStage(stage));
  }
  return error;
}

export async function runOwnerPackageVerifierStage(stage, operation) {
  if (typeof operation !== 'function') throw new Error('operation is required');
  const normalizedStage = approvedStage(stage);
  try {
    return await operation();
  } catch (error) {
    throw tagError(error, normalizedStage);
  }
}

export function ownerPackageVerifierFailureStage(error) {
  if (!error || (typeof error !== 'object' && typeof error !== 'function')) return 'UNCLASSIFIED';
  return approvedStage(stageByError.get(error));
}
