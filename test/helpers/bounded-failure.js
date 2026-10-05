import assert from 'node:assert/strict';

// A test watchdog catches the old unbounded implementation without hanging the
// test process. It is independent from the production deadline being tested.
export async function expectBoundedFailure(operation, phase) {
  let timer;
  try {
    const outcome = await Promise.race([
      operation.then(value => ({ value }), error => ({ error })),
      new Promise(resolve => { timer = setTimeout(() => resolve({ stalled: true }), 200); })
    ]);
    assert.equal(outcome.stalled, undefined, 'request did not return within the test watchdog');
    assert.match(outcome.error?.message || '', /Google Sheets request timed out/);
    assert.equal(outcome.error.phase, phase);
  } finally {
    clearTimeout(timer);
  }
}
