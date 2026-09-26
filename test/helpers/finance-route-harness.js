import { registerHooks } from 'node:module';

let sequence = 0;

export function response() {
  return {
    statusCode: 200,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

// Replace external boundaries only; route dispatch, both orchestrators, the
// manual handler, and the durable execution controller remain real.
export async function financeRouteHarness(t, { busy = false, schemaOk = true, sourceOk = true } = {}) {
  const key = `financeRouteHarness${++sequence}`;
  const events = [];
  const entries = [];
  const stores = [];
  const stageStatuses = new Map();
  let consumed = false;
  let cycle = null;
  let owner = busy ? 'foreign-owner' : null;
  const staging = new Map([
    ['РОП_План_Сентябрь', [[], ['Manager', 'Branch', 'Branch', 100, 100, '5/2', 'Да']]]
  ]);
  const sheetTitle = range => range.match(/^'(.+)'!/)?.[1];
  const child = name => async (req, res) => {
    events.push(name);
    const statusCode = stageStatuses.get(name) || 200;
    return res.status(statusCode).json({ ok: statusCode < 400, mode: 'commit', verified: true, matches: 1, total: 1 });
  };
  const decisions = child('decisions');
  decisions.dataHealth = child('dataHealth');
  const fixture = {
    google: {
      auth: { JWT: class { async authorize() { events.push('google-authorize'); } } },
      sheets: () => {
        events.push('google-client');
        return { client: 'sheets', spreadsheets: {
          get: async () => ({ data: { sheets: [] } }), batchUpdate: async () => ({ data: {} }),
          values: {
            get: async ({ range }) => ({ data: { values: structuredClone(staging.get(sheetTitle(range)) || []) } }),
            clear: async ({ range }) => { staging.set(sheetTitle(range), []); },
            update: async ({ range, requestBody }) => { staging.set(sheetTitle(range), structuredClone(requestBody.values)); }
          }
        } };
      }
    },
    hours: child('hours'), payments: child('payments'), decisions,
    balances: child('balances'),
    cycleStore: ({lease}) => ({
      acquire: async owner => (await lease.ensureSchema()).ok ? lease.acquireLease({runId:owner}) : {ok:false},
      release: owner => lease.releaseLease({runId:owner}),
      read: async () => structuredClone(cycle),
      write: async state => { cycle=structuredClone(state); events.push(`checkpoint:${state.status}:${state.cursor}`); }
    }),
    reports: async () => {events.push('reports');return {ok:true,verified:true,fingerprint:'a'.repeat(64)};},
    ownerQueue: async () => { events.push('ownerActionQueue'); return { ok: true }; },
    publish: async () => ({ ok: true }),
    sourceFactory: () => ({}),
    sourceHandler: ({ afterSourceVerified }) => async (req, res) => {
      events.push('receivablesSource');
      if (!sourceOk) return res.status(502).json({ ok: false, errorClass: 'ASHK_TIMEOUT' });
      await afterSourceVerified({ groups: [], contractsByGroup: new Map() });
      return res.status(200).json({ ok: true, studentName: 'PRIVATE_STUDENT', debt: 999 });
    },
    marker: async ({ key }) => { events.push(`marker:${key}`); },
    rop: async () => {
      events.push('ropPublish');
      return { ok: true, liveDate: '2026-09-18', businessPayload: 'PRIVATE_ROP' };
    },
    tochka: () => child('tochkaDds'),
    token: async ({ providedToken }) => {
      events.push('token');
      if (consumed || providedToken !== 'single-use') return { ok: false };
      consumed = true;
      return { ok: true };
    },
    store: options => {
      events.push('store');
      stores.push(options);
      return {
        ensureSchema: async () => { events.push('schema'); return { ok: schemaOk }; },
        acquireLease: async ({ runId }) => {
          events.push('acquire');
          if (owner) return { ok: false, busy: true };
          owner = runId;
          return { ok: true };
        },
        readRetry: async () => null,
        appendAttempt: async entry => { events.push(`ledger:${entry.stage}`); entries.push(entry); return { ok: true }; },
        writeRetry: async () => ({ ok: true }),
        clearRetry: async () => ({ ok: true }),
        releaseLease: async ({ runId }) => {
          events.push('release');
          if (owner === runId) owner = null;
          return { ok: true };
        }
      };
    }
  };
  globalThis[key] = fixture;
  const modules = {
    googleapis: 'export const google = f.google;',
    '../lib/google-sheets-finance-cycle-store.js': 'export const createFinanceCycleStore = f.cycleStore;',
    '../lib/google-sheets-finance-reports.js': 'export const refreshGoogleSheetsFinanceReports = f.reports; export const verifyGoogleSheetsFinanceReports = async () => ({ok:true});',
    './sync-hours.js': 'export default f.hours;',
    './sync-payments.js': 'export default f.payments;',
    './decision-reconcile-daily.js': 'export default f.decisions;',
    './decision-event.js': 'export const processOwnerActionQueue = f.ownerQueue;',
    './balances.js': 'export const refreshBalancesMirrorOnly = f.balances;',
    './health.js': 'export const publishRopNow = f.publish;',
    '../lib/ashk-receivables-source.js': 'export const createAshkReceivablesSource = f.sourceFactory;',
    '../lib/receivables-sync-handler.js': 'export const createReceivablesSyncHandler = f.sourceHandler;',
    '../lib/rop-publisher.js': 'export const syncRopSourceThenPublishTarget = f.rop; export const mergeDebtorManualFields = () => {};',
    '../lib/google-sheets-sync-marker.js': 'export const writeControlMarker = f.marker;',
    '../lib/one-time-finance-run-token.js': 'export const consumeOneTimeFinanceRunToken = f.token;',
    '../lib/tochka-dds-import.js': 'export const createTochkaDdsImportHandler = f.tochka; export const syncCurrentDayTochkaDds = () => {};',
    '../lib/google-sheets-finance-run-store.js': 'export const createGoogleSheetsFinanceRunStore = f.store;'
  };
  const routeUrl = new URL(`../../api/nightly-finance-orchestrator.js?harness=${sequence}`, import.meta.url).href;
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (context.parentURL === routeUrl && modules[specifier]) {
        const source = `const f = globalThis[${JSON.stringify(key)}]; ${modules[specifier]}`;
        return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    }
  });
  const env = {
    ASHK_API_KEY: 'test-only', CRON_SECRET: 'route-secret',
    GOOGLE_SERVICE_ACCOUNT_EMAIL: 'test@example.invalid', GOOGLE_PRIVATE_KEY: 'test-only',
    VERCEL_GIT_COMMIT_SHA: 'deployment-sha-test'
  };
  const previous = Object.fromEntries(Object.keys(env).map(name => [name, process.env[name]]));
  Object.assign(process.env, env);
  t.after(() => {
    hooks.deregister();
    delete globalThis[key];
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  const route = await import(routeUrl);
  return {
    route, events, entries, stores,
    setStageStatus(name, statusCode) { stageStatuses.set(name, statusCode); },
    get cycle() { return cycle; }, get consumed() { return consumed; }
  };
}

export const cronRequest = schedule => ({
  method: 'GET', headers: { authorization: 'Bearer route-secret', 'x-vercel-cron-schedule': schedule }
});
