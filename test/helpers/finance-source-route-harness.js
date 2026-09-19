import { registerHooks } from 'node:module';

let sequence = 0;
export const CONTRACT_SHEET = 'АШК_Контракты_ТекущийМесяц__vercel';
export const DETAIL_SHEET = 'АШК_Дебиторка__vercel';
export const CONTRACT_HEADERS = ['StudentId', 'Дата договора', 'Филиал', 'Филиал АШК', 'Менеджер', 'Продажи', 'Оплачено', 'Долг', 'Статус', 'Договор'];

// Only external I/O is replaced. Source handler, contract/ROP builders, publisher
// boundary, marker writer, and route functions remain real.
export async function financeSourceRouteHarness(t, { initialContracts = [], contractFault = '', publishFails = false, zeroContracts = false } = {}) {
  const key = `sourceRoute${++sequence}`;
  const events = [];
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Yekaterinburg', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = type => parts.find(value => value.type === type).value;
  const month = `${part('year')}-${part('month')}`;
  const date = `${month}-${part('day')}`;
  const tables = new Map([
    [CONTRACT_SHEET, structuredClone(initialContracts)],
    ['РОП_План_Сентябрь', [['Менеджер','Филиал','Филиал АШК','План филиала','План менеджера','График','Активен','Примечание'], ['Manager', 'Branch', 'Branch', 100000, 100000, '5/2', 'Да', '']]],
    ['АШК_Оплаты__vercel', [['Id', 'PayDate', 'StudentId', 'SaleId', 'ProductId', 'ProductName', 'SaleSum', 'Debit', 'PaymentEmployeeName', 'SaleEmployeeName', 'SaleAttributionStatus']]],
    ['РОП_Дебиторка_Приоритет', []],
    ['__vercel_control', [['receivables_last_success_utc', 'old-marker']]]
  ]);
  const payload = {
    groups: [{ Id: 10, TrainingRoomName: 'Branch' }],
    contractsByGroup: new Map([[10, zeroContracts ? [] : [
      { Id: 101, StudyGroupId: 10, OwnerName: 'Manager', ContractDate: `${month}-01`, SalesSum: 100000, DebitSum: 80000, Debt: 20000, ContractName: 'Current' },
      { Id: 102, StudyGroupId: 10, OwnerName: 'Manager', ContractDate: `${month}-02`, SalesSum: 50000, DebitSum: 50000, Debt: 0, ContractName: 'Paid' }
    ]]])
  };
  const title = range => range.match(/^'(.+)'!/)?.[1];
  let contractWritten = false;
  const sheets = { spreadsheets: {
    get: async () => ({ data: { sheets: [...tables.keys()].map((name, index) => ({ properties: { sheetId: index, title: name, gridProperties: { rowCount: 1000, columnCount: 24 } } })) } }),
    batchUpdate: async ({ requestBody }) => {
      for (const request of requestBody.requests) if (request.addSheet) tables.set(request.addSheet.properties.title, []);
      return { data: {} };
    },
    values: {
      clear: async ({ range }) => { tables.set(title(range), []); },
      update: async ({ range, requestBody }) => {
        const name = title(range);
        events.push(`write:${name}`);
        if (name === CONTRACT_SHEET && contractFault === 'write') throw new Error('PRIVATE_WRITE');
        const cell = range.match(/!B(\d+)$/);
        if (cell) tables.get(name)[Number(cell[1]) - 1][1] = requestBody.values[0][0];
        else tables.set(name, structuredClone(requestBody.values));
        if (name === CONTRACT_SHEET) contractWritten = true;
        return { data: {} };
      },
      get: async ({ range }) => {
        const name = title(range);
        events.push(`read:${name}`);
        if (name === CONTRACT_SHEET && contractWritten && contractFault === 'read') throw new Error('PRIVATE_READ');
        const rows = structuredClone(tables.get(name) || []);
        if (name === CONTRACT_SHEET && contractWritten && contractFault === 'mismatch' && rows[1]) rows[1][7] = 999;
        if (name === 'РОП_Задачи_Сегодня' && rows.length) {
          while (rows[0].length < 24) rows[0].push('');
          rows[0][16] = 'План сбора ДЗ, ₽'; rows[0][23] = 'Готовность к сбору';
          for (const row of rows.slice(1)) row[16] = 1000;
        }
        return { data: { values: rows } };
      },
      append: async ({ range, requestBody }) => { tables.get(title(range)).push(...structuredClone(requestBody.values)); return { data: {} }; }
    }
  } };
  const fixture = {
    google: { auth: { JWT: class { async authorize() {} } }, sheets: () => sheets },
    source: () => ({ fetchCurrent: async () => { events.push('fetch'); return payload; }, fetchStudent: async () => { throw new Error('Unexpected refetch'); } }),
    publish: async () => { events.push('publish'); if (publishFails) throw new Error('PRIVATE_PUBLISH'); return { ok: true, sheets: 5 }; }
  };
  globalThis[key] = fixture;
  const url = new URL(`../../api/nightly-finance-orchestrator.js?source-test=${sequence}`, import.meta.url).href;
  const modules = {
    googleapis: 'export const google = f.google;',
    '../lib/ashk-receivables-source.js': 'export const createAshkReceivablesSource = f.source;',
    './health.js': 'export const publishRopNow = f.publish;'
  };
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (context.parentURL === url && modules[specifier]) return { url: `data:text/javascript,${encodeURIComponent(`const f = globalThis[${JSON.stringify(key)}]; ${modules[specifier]}`)}`, shortCircuit: true };
    return next(specifier, context);
  } });
  const names = ['ASHK_API_KEY', 'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  for (const name of names) process.env[name] = 'test-only';
  t.after(() => {
    hooks.deregister(); delete globalThis[key];
    for (const name of names) if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name];
  });
  return { route: await import(url), tables, events, payload, date, month };
}
