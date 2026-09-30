import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { drainFinanceRecovery } from '../scripts/finance-recovery-worker.mjs';

const hourlyWorkflow = readFileSync(
  new URL('../.github/workflows/hourly-project-continuation.yml', import.meta.url),
  'utf8'
);
const recoveryUrl = new URL('../.github/workflows/finance-recovery.yml', import.meta.url);
const workerUrl = new URL('../scripts/finance-recovery-worker.mjs', import.meta.url);

test('finance recovery uses a dedicated all-day scheduled workflow', () => {
  assert.equal(existsSync(fileURLToPath(recoveryUrl)), true, 'dedicated finance recovery workflow is required');
  const recoveryWorkflow = readFileSync(recoveryUrl, 'utf8');

  assert.match(recoveryWorkflow, /cron:\s*'7,17,27,37,47,57 \* \* \* \*'/);
  assert.match(recoveryWorkflow, /group:\s*finance-recovery/);
  assert.match(recoveryWorkflow, /actions\/checkout@v7/);
  assert.match(recoveryWorkflow, /node scripts\/finance-recovery-worker\.mjs/);
  assert.doesNotMatch(hourlyWorkflow, /cron:\s*'\*\/10 \* \* \* \*'/);
});

test('the independent hourly workflow also resumes pending finance cycles', () => {
  assert.equal(existsSync(fileURLToPath(workerUrl)), true, 'shared recovery worker is required');
  assert.match(hourlyWorkflow, /finance-recovery-fallback:/);
  assert.match(hourlyWorkflow, /github\.event\.schedule == '23 \* \* \* \*'/);
  assert.match(hourlyWorkflow, /node scripts\/finance-recovery-worker\.mjs/);
});

test('finance sync script receives the GitHub event name before choosing recovery mode', () => {
  assert.match(
    hourlyWorkflow,
    /GITHUB_EVENT_NAME:\s*\$\{\{\s*github\.event_name\s*\}\}/
  );
});

async function runRecovery(responses,waits=[]) {
  let tokens=0, stages=0;
  const fetch=async url=>{
    if(String(url).startsWith('https://oidc.invalid')) {tokens++;return {ok:true,json:async()=>({value:'test'})};}
    stages++;
    const result=responses.shift();
    if(!result)throw Error('Unexpected stage request');
    return {ok:result.status<300,status:result.status,json:async()=>result.body};
  };
  await drainFinanceRecovery({
    fetchFn: fetch,
    env: {
      ACTIONS_ID_TOKEN_REQUEST_URL:'https://oidc.invalid',
      ACTIONS_ID_TOKEN_REQUEST_TOKEN:'fixture',
      FINANCE_SYNC_ENDPOINT:'https://finance.invalid'
    },
    sleep: async ms => { waits.push(ms); },
    logger: { log() {} }
  });
  return {tokens,stages};
}
test('recovery drains pending stages with a fresh OIDC token and stops on completion',async()=>{
  assert.deepEqual(await runRecovery([{status:202,body:{ok:true,pending:true}},{status:200,body:{ok:true,complete:true}}]),{tokens:2,stages:2});
});
test('recovery stops on busy lease and fails visibly on failed stage',async()=>{
  assert.deepEqual(await runRecovery([{status:409,body:{ok:false,busy:true}}]),{tokens:1,stages:1});
  await assert.rejects(runRecovery([{status:503,body:{ok:false,stage:'reports',errorClass:'SOURCE_CHANGED'}}]),/reports.*SOURCE_CHANGED/);
});
test('recovery retries a checkpoint transport failure with a new token and resumes',async()=>{
 assert.deepEqual(await runRecovery([{status:503,body:{ok:false,errorClass:'CHECKPOINT_FAILED'}},{status:202,body:{ok:true,pending:true}},{status:200,body:{ok:true,complete:true}}]),{tokens:3,stages:3});
});
test('recovery stops after bounded transient failures',async()=>{
 await assert.rejects(runRecovery(Array.from({length:3},()=>({status:503,body:{ok:false,errorClass:'CHECKPOINT_FAILED'}}))),/CHECKPOINT_FAILED/);
});
test('temporary report stage failure resumes while the three-attempt circuit breaker is respected',async()=>{
 assert.deepEqual(await runRecovery([{status:503,body:{ok:false,errorClass:'REPORT_TRANSPORT',attempt:1}},{status:200,body:{ok:true,complete:true}}]),{tokens:2,stages:2});
 await assert.rejects(runRecovery([{status:503,body:{ok:false,errorClass:'REPORT_TRANSPORT',attempt:3}}]),/REPORT_TRANSPORT/);
 await assert.rejects(runRecovery([{status:503,body:{ok:false,errorClass:'REPORT_VALIDATION',attempt:1}}]),/REPORT_VALIDATION/);
});
test('downstream decision blockers are retried until the cycle records a degraded completion',async()=>{
 const waits=[];
 assert.deepEqual(await runRecovery([
  {status:503,body:{ok:false,stage:'decisions',errorClass:'REPORT_STALE',attempt:1}},
  {status:503,body:{ok:false,stage:'decisions',errorClass:'REPORT_STALE',attempt:2}},
  {status:200,body:{ok:true,stage:'decisions',degraded:true,complete:true}}
 ],waits),{tokens:3,stages:3});
 assert.deepEqual(waits,[2000,4000]);
});
test('recovery stops cleanly on source cooldown rather than consuming more attempts',async()=>{
 assert.deepEqual(await runRecovery([{status:202,body:{ok:true,pending:true,complete:false,deferred:true}}]),{tokens:1,stages:1});
});
test('bank import transport failure retries the idempotent stage within its attempt limit',async()=>{
 assert.deepEqual(await runRecovery([{status:503,body:{ok:false,errorClass:'DDS_TRANSPORT',attempt:1}},{status:200,body:{ok:true,complete:true}}]),{tokens:2,stages:2});
 await assert.rejects(runRecovery([{status:503,body:{ok:false,errorClass:'DDS_IMPORT_FAILED',attempt:1}}]),/DDS_IMPORT_FAILED/);
});
test('Sheets quota during hours sync waits before retrying the same stage',async()=>{
 assert.deepEqual(await runRecovery([{status:503,body:{ok:false,errorClass:'HOURS_TRANSPORT',attempt:1}},{status:202,body:{ok:true,pending:true}},{status:200,body:{ok:true,complete:true}}]),{tokens:3,stages:3});
 await assert.rejects(runRecovery([{status:503,body:{ok:false,errorClass:'HOURS_SYNC_FAILED',attempt:1}}]),/HOURS_SYNC_FAILED/);
});
test('recovery spaces quota-heavy stage boundaries without restarting completed work',async()=>{
 const waits=[];
 const result=await runRecovery([
   {status:202,body:{ok:true,pending:true,stage:'payments',nextStage:'hours'}},
   {status:202,body:{ok:true,pending:true,stage:'hours',nextStage:'receivablesSource'}},
   {status:202,body:{ok:true,pending:true,stage:'balances',nextStage:'reportVerification'}},
   {status:200,body:{ok:true,pending:false,complete:true}}
 ],waits);
 assert.deepEqual(result,{tokens:4,stages:4});
 assert.deepEqual(waits,[65000,65000]);
});
