import test from 'node:test';
import assert from 'node:assert/strict';
import { enableCashPhotoDriveApi } from '../lib/cash-photo-drive-api-enable.js';

test('enables only Drive API in the fixed Google Cloud project', async () => {
  let request;
  const auth = {
    async request(args) {
      request = args;
      return { data: { name: 'operations/acf.test' } };
    }
  };

  const result = await enableCashPhotoDriveApi({ auth });

  assert.deepEqual(request, {
    url: 'https://serviceusage.googleapis.com/v1/projects/798693414461/services/drive.googleapis.com:enable',
    method: 'POST'
  });
  assert.deepEqual(result, { ok: true, operation: 'operations/acf.test' });
});

test('fails closed if Google does not return an operation name', async () => {
  const auth = { async request() { return { data: {} }; } };
  await assert.rejects(enableCashPhotoDriveApi({ auth }), /operation/i);
});
