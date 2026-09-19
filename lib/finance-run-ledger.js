export const FINANCE_LEDGER_HEADERS = Object.freeze([
  'runId', 'startedAtUtc', 'finishedAtUtc', 'trigger', 'mode', 'stage', 'attempt',
  'result', 'statusCode', 'errorClass', 'retryable', 'retryAfterUtc', 'deploymentSha'
]);

const RESULTS = new Set(['SUCCESS', 'FAILED', 'SKIPPED', 'RECOVERED']);

export function financeLedgerRow(entry = {}) {
  if (!RESULTS.has(entry.result)) throw new Error('invalid ledger result');
  for (const name of Object.keys(entry)) {
    if (!FINANCE_LEDGER_HEADERS.includes(name)) throw new Error(`unknown ledger field: ${name}`);
  }
  return FINANCE_LEDGER_HEADERS.map(name => entry[name] ?? '');
}
