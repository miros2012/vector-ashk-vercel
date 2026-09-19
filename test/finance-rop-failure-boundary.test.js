import test from 'node:test';
import assert from 'node:assert/strict';
import { syncRopSourceThenPublishTarget } from '../lib/rop-publisher.js';
import { createNightlyFinanceOrchestrator } from '../lib/nightly-finance-orchestrator.js';
import { createIntradayRopOrchestrator } from '../lib/rop-intraday-orchestrator.js';

const success = async (_req, res) => res.status(200).json({ ok: true, mode: 'commit', verified: true, matches: 1, total: 1 });
const fail = () => { throw new Error('PRIVATE_STUDENT provider body'); };

for (const [boundary, refreshSource, publishTarget, errorClass, retryable] of [
  ['build', fail, async () => ({ ok: true }), 'ROP_BUILD', false],
  ['publish throw', async () => ({ ok: true }), fail, 'ROP_PUBLISH', true],
  ['publish readback', async () => ({ ok: true }), async () => ({ ok: false, body: 'PRIVATE_STUDENT' }), 'ROP_PUBLISH', true]
]) {
  test(`real ROP helper classifies ${boundary} with only safe metadata`, async () => {
    const result = await syncRopSourceThenPublishTarget({ refreshSource, publishTarget });
    assert.deepEqual(result, { ok: false, statusCode: 502, errorClass, retryable });
  });
}

for (const [mode, factory] of [['nightly', createNightlyFinanceOrchestrator], ['intraday', createIntradayRopOrchestrator]]) {
  for (const [label, runRopPublish, errorClass, retryable] of [
    ['build throw', async () => { throw Object.assign(new Error('PRIVATE_STUDENT'), { errorClass: 'ROP_BUILD', statusCode: 502 }); }, 'ROP_BUILD', false],
    ['publish throw', fail, 'ROP_PUBLISH', true],
    ['real helper', () => syncRopSourceThenPublishTarget({ refreshSource: async () => ({ ok: true }), publishTarget: fail }), 'ROP_PUBLISH', true]
  ]) {
    test(`${mode} preserves ${label} classification for the controlled direct callable`, async () => {
      let outcome;
      const handler = factory({
        cronSecret: 'test', runHours: success, runPayments: success,
        runReceivablesSource: success, runRopPublish,
        runDataHealth: success, runDecisions: success, runOwnerActionQueue: async () => ({ ok: true }),
        runControl: {
          begin: async () => ({ ok: true }), pendingRecovery: async () => null, finish: async () => {},
          runStage: async (_context, { stage, execute }) => {
            const result = await execute();
            if (stage === 'ropPublish') outcome = result;
            return result;
          }
        }
      });
      const res = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
      await handler({ method: 'GET', headers: { authorization: 'Bearer test' } }, res);
      assert.deepEqual(outcome, { ok: false, statusCode: 502, errorClass, retryable });
      assert.equal(res.body.stages.receivablesSource.ok, true);
      assert.doesNotMatch(JSON.stringify(res.body), /PRIVATE_STUDENT/);
    });
  }
}
