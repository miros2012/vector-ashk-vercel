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
      const stage = sequence(state.mode)[state.cursor];
      if (typeof stages[stage] !== 'function') throw Error('Missing cycle stage');
      state = { ...state, status: 'RUNNING', attempt: state.attempt + 1, updatedAt: now().toISOString(), errorClass: '' };
      await store.write(state);
      let result;
      try { result = await stages[stage]({ cycle: state }); }
      catch { result = { ok: false, errorClass: 'STAGE_FAILED' }; }
      if (result?.ok !== true) {
        const reportCursor = sequence(state.mode).indexOf('reportVerification');
        if (result?.errorClass === 'REPORT_STALE' && reportCursor >= 0 && state.cursor > reportCursor) {
          state.cursor = reportCursor; state.completed = state.completed.slice(0,reportCursor);
          state.status = 'PENDING'; state.attempt = 0; state.updatedAt = now().toISOString();
          await store.write(state);
          return {ok:false,pending:true,statusCode:503,stage,errorClass:'REPORT_STALE'};
        }
        state.status = state.attempt >= 3 ? 'BLOCKED' : 'FAILED';
        state.errorClass = /^[A-Z_]{1,40}$/.test(result?.errorClass || '') ? result.errorClass : 'STAGE_FAILED';
        state.updatedAt = now().toISOString();
        await store.write(state);
        return { ok: false, stage, pending: true, statusCode: 503, errorClass: state.errorClass, attempt: state.attempt };
      }
      state.completed.push({ stage, ok: true, at: now().toISOString(),
        ...(/^[a-f0-9]{64}$/.test(result.fingerprint || '') ? {fingerprint:result.fingerprint} : {}) });
      state.cursor++; state.attempt = 0; state.updatedAt = now().toISOString();
      state.status = state.cursor === sequence(state.mode).length ? 'COMPLETE' : 'PENDING';
      if (state.status === 'COMPLETE') state.finishedAt = state.updatedAt;
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
