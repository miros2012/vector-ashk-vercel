import { randomUUID } from 'node:crypto';

export const FINANCE_CYCLE_VERSION = 1;
export function financeCycleSequence(mode) {
  return ['tochkaDds', 'reports', 'payments', ...(mode === 'full' ? ['hours'] : []),
    'receivablesSource', 'ropPublish', 'balances', 'reportVerification', 'dataHealth', 'decisions'];
}

export function validFinanceCycle(state, sequence = financeCycleSequence) {
  if (!state || state.version !== FINANCE_CYCLE_VERSION || !state.id
    || !['full', 'intraday'].includes(state.mode)
    || !['PENDING', 'RUNNING', 'FAILED', 'BLOCKED', 'COMPLETE'].includes(state.status)
    || !Number.isInteger(state.cursor) || !Number.isInteger(state.attempt) || state.attempt < 0
    || !Array.isArray(state.completed) || !Number.isFinite(Date.parse(state.startedAt))) return false;
  if (state.finalImportDone !== undefined && typeof state.finalImportDone !== 'boolean') return false;
  if (state.tailRefreshes !== undefined && (!Number.isInteger(state.tailRefreshes) || state.tailRefreshes < 0)) return false;
  if (state.resumeAfter !== undefined && !Number.isFinite(Date.parse(state.resumeAfter))) return false;
  const names = sequence(state.mode);
  return state.cursor >= 0 && state.cursor <= names.length
    && state.completed.length === state.cursor
    && state.completed.every((entry, index) => entry.stage === names[index] && entry.ok === true)
    && ((state.status === 'COMPLETE') === (state.cursor === names.length));
}

// One external stage per invocation. A hard runtime kill leaves RUNNING on the
// same cursor; the shared lease prevents another worker from replaying it early.
export function createFinanceCycle({ store, stages, sequence = financeCycleSequence, onCycleStart = async () => {}, now = () => new Date() }) {
  return async function run({ mode = 'intraday', recoveryOnly = false } = {}) {
    const owner = randomUUID(); let acquired = false;
    try {
      const lease = await store.acquire(owner);
      if (!lease?.ok) return { ok: false, busy: lease?.busy === true, statusCode: lease?.busy ? 409 : 503 };
      acquired = true;
      let state = await store.read();
      if (state && !validFinanceCycle(state, sequence)) throw Error('Invalid finance cycle');
      if (state?.status !== 'COMPLETE' && state?.mode === 'intraday' && mode === 'full' && !recoveryOnly) state.pendingFull = true;
      const queuedFull = state?.status === 'COMPLETE' && state.pendingFull === true;
      if (queuedFull) mode = 'full';
      if ((!state || state.status === 'COMPLETE') && recoveryOnly && !queuedFull) {
        return { ok: true, mode: 'recovery_idle', pending: false, complete: state?.status === 'COMPLETE' };
      }
      if (!state || state.status === 'COMPLETE') {
        if (!['full', 'intraday'].includes(mode)) throw Error('Invalid cycle mode');
        let ownerQueueWarning = '';
        if (state?.status === 'COMPLETE' && mode === 'intraday') {
          try { await onCycleStart(state); } catch { ownerQueueWarning = 'OWNER_QUEUE_FAILED'; }
        }
        state = { version: 1, id: randomUUID(), mode, status: 'PENDING', cursor: 0, attempt: 0,
          startedAt: now().toISOString(), completed: [], ownerQueueWarning, lastCompletedAt: state?.finishedAt || null };
      }
      if (state.status === 'RUNNING' && state.attempt >= 3) { state.status = 'BLOCKED'; await store.write(state); }
      if (state.status === 'BLOCKED' && recoveryOnly) return { ok: false, blocked: true, stage: sequence(state.mode)[state.cursor], statusCode: 503 };
      if (state.status === 'BLOCKED') state.attempt = 0;
      if (state.resumeAfter) {
        if (Date.parse(state.resumeAfter) > now().getTime()) {
          await store.write(state);
          return {ok:true,pending:true,complete:false,deferred:true,statusCode:202,
            reason:'SOURCE_UPDATING',resumeAfter:state.resumeAfter,lastCompletedAt:state.lastCompletedAt};
        }
        delete state.resumeAfter; state.tailRefreshes=0;
      }
      const cursorStage = sequence(state.mode)[state.cursor];
      // A checkpointed substep preserves compatibility with already-running v1
      // cycles. A hard kill safely retries the idempotent import, not payments.
      const finalImport = cursorStage === 'reportVerification' && typeof stages.tochkaDds === 'function' && !state.finalImportDone;
      const stage = finalImport ? 'tochkaDdsFinal' : cursorStage;
      const execute = finalImport ? stages.tochkaDds : stages[stage];
      if (typeof execute !== 'function') throw Error('Missing cycle stage');
      state = { ...state, status: 'RUNNING', attempt: state.attempt + 1, updatedAt: now().toISOString(), errorClass: '' };
      await store.write(state);
      let result;
      try { result = await execute({ cycle: state }); }
      catch { result = { ok: false, errorClass: 'STAGE_FAILED' }; }
      if (result?.ok !== true) {
        const reportCursor = sequence(state.mode).indexOf('reportVerification');
        const transportFailure = ['DDS_TRANSPORT', 'REPORT_TRANSPORT', 'HOURS_TRANSPORT'].includes(result?.errorClass);
        if (transportFailure && state.attempt >= 3) {
          state.status = 'PENDING'; state.attempt = 0;
          state.errorClass = result.errorClass;
          state.resumeAfter = new Date(now().getTime() + 5 * 60 * 1000).toISOString();
          state.updatedAt = now().toISOString();
          await store.write(state);
          return {ok:true,pending:true,complete:false,deferred:true,statusCode:202,
            stage,reason:'UPSTREAM_UNAVAILABLE',resumeAfter:state.resumeAfter,
            lastCompletedAt:state.lastCompletedAt};
        }
        const sameMissing = result?.errorClass === 'DDS_PENDING' && result.sourceFingerprint
          && result.sourceFingerprint === state.ddsPendingFingerprint;
        if (sameMissing) result = {...result,errorClass:'DDS_IMPORT_INCOMPLETE'};
        const changedWhileCalculating=result?.errorClass==='SOURCE_CHANGED' && ['reports','reportVerification'].includes(cursorStage);
        if (changedWhileCalculating || (['REPORT_STALE','DDS_PENDING'].includes(result?.errorClass) && reportCursor >= 0 && state.cursor > reportCursor)) {
          if (result.errorClass === 'DDS_PENDING' && /^[a-f0-9]{64}$/.test(result.sourceFingerprint || '')) state.ddsPendingFingerprint=result.sourceFingerprint;
          state.cursor = changedWhileCalculating?state.cursor:reportCursor; state.completed = state.completed.slice(0,state.cursor);
          state.finalImportDone=false;
          state.waitingForSource=true;
          state.tailRefreshes=(state.tailRefreshes || 0)+1;
          state.status = 'PENDING'; state.attempt = 0; state.updatedAt = now().toISOString(); state.errorClass='';
          if (state.tailRefreshes > 2) state.resumeAfter=new Date(now().getTime()+5*60*1000).toISOString();
          await store.write(state);
          return {ok:true,pending:true,complete:false,statusCode:202,stage,reason:'SOURCE_UPDATING',
            deferred:Boolean(state.resumeAfter),resumeAfter:state.resumeAfter,lastCompletedAt:state.lastCompletedAt};
        }
        state.status = state.attempt >= 3 ? 'BLOCKED' : 'FAILED';
        state.errorClass = /^[A-Z_]{1,40}$/.test(result?.errorClass || '') ? result.errorClass : 'STAGE_FAILED';
        state.updatedAt = now().toISOString();
        await store.write(state);
        return { ok: false, stage, pending: true, statusCode: 503, errorClass: state.errorClass, attempt: state.attempt };
      }
      if (finalImport) {
        state.finalImportDone=true;state.finalImportAt=now().toISOString();
        state.status='PENDING';state.attempt=0;state.updatedAt=state.finalImportAt;
        await store.write(state);
        return {ok:true,pending:true,complete:false,stage,nextStage:'reportVerification',statusCode:202};
      }
      state.completed.push({ stage, ok: true, at: now().toISOString(),
        ...(/^[a-f0-9]{64}$/.test(result.fingerprint || '') ? {fingerprint:result.fingerprint} : {}) });
      state.cursor++; state.attempt = 0; state.updatedAt = now().toISOString();
      state.status = state.cursor === sequence(state.mode).length ? 'COMPLETE' : 'PENDING';
      if (state.status === 'COMPLETE') { state.finishedAt = state.updatedAt; delete state.waitingForSource; }
      await store.write(state);
      const pending = state.status !== 'COMPLETE' || state.pendingFull === true;
      return { ok: true, mode: 'finance_cycle', cycleId: state.id, stage,
        pending, complete: !pending,
        ownerQueueWarning: state.ownerQueueWarning || undefined,
        nextStage: sequence(state.mode)[state.cursor] || (state.pendingFull ? sequence('full')[0] : null), statusCode: pending ? 202 : 200 };
    } catch {
      return { ok: false, statusCode: 503, errorClass: 'CHECKPOINT_FAILED' };
    } finally {
      if (acquired) { try { await store.release(owner); } catch { /* Durable checkpoint remains authoritative; lease expires. */ } }
    }
  };
}
