import test from 'node:test';
import assert from 'node:assert/strict';
import { createReceivablesSyncHandler } from '../lib/receivables-sync-handler.js';

function responseRecorder() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader() {}
  };
}

test('receivables sync writes positive-debt detail, verifies readback, and returns matching summary', async () => {
  const writes = { detail: null, summary: null };
  const fetchCurrent = async () => ({
    groups: [
      { Id: 10, TrainingRoomName: 'Герцена' },
      { Id: 20, TrainingRoomName: 'Гондатти' }
    ],
    contractsByGroup: new Map([
      [10, [
        { Id: 101, PersonName: 'Иванов Иван', OwnerName: 'Менеджер А', Debt: 30000, SalesSum: 100000, DebitSum: 70000 },
        { Id: 102, OwnerName: 'Менеджер А', Debt: 0, SalesSum: 50000, DebitSum: 50000 }
      ]],
      [20, [
        { Id: 201, OwnerName: 'Менеджер Б', Debt: 20000, SalesSum: 80000, DebitSum: 60000 }
      ]]
    ])
  });

  const handler = createReceivablesSyncHandler({
    fetchCurrent,
    writeDetail: async values => { writes.detail = values; },
    writeSummary: async values => { writes.summary = values; },
    readDetail: async () => writes.detail,
    readSummary: async () => writes.summary
  });

  const res = responseRecorder();
  await handler({ method: 'GET' }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.verified, true);
  assert.deepEqual(res.body.total, { contracts: 2, debt: 50000, salesSum: 180000, debitSum: 130000 });
  assert.equal(JSON.stringify(res.body).includes('Менеджер А'), false);
  assert.equal(writes.detail.length, 3);
  assert.equal(writes.detail[0][0], 'StudentId');
  assert.equal(writes.detail[0][1], 'Курсант');
  assert.equal(writes.detail[1][1], 'Иванов Иван');
  assert.deepEqual(writes.detail.slice(1).map(row => row[0]), [101, 201]);
  assert.equal(writes.summary[0][0], 'Тип');
  assert.equal(writes.summary.some(row => row[0] === 'ИТОГО' && row[3] === 50000), true);
  assert.equal(writes.summary.some(row => row[0] === 'МЕНЕДЖЕР' && row[1] === 'Менеджер А' && row[3] === 30000), true);
  assert.equal(writes.summary.some(row => row[0] === 'ФИЛИАЛ' && row[1] === 'Гондатти' && row[3] === 20000), true);
});

test('receivables sync fails closed when detail or summary readback does not match source totals', async () => {
  const expectedDetail = [
    ['StudentId','GroupId','Филиал','Менеджер','Договор','Дата договора','Статус','Продажи','Оплачено','Долг','Долг основной услуги','Основная услуга','Последняя оплата'],
    [101,10,'Герцена','Менеджер А','','','',100000,70000,30000,0,'','']
  ];
  const expectedSummary = [
    ['Тип','Объект','Договоров','Долг','Продажи','Оплачено'],
    ['ИТОГО','',1,30000,100000,70000]
  ];

  const handler = createReceivablesSyncHandler({
    fetchCurrent: async () => ({
      groups: [{ Id: 10, TrainingRoomName: 'Герцена' }],
      contractsByGroup: new Map([[10, [
        { Id: 101, OwnerName: 'Менеджер А', Debt: 30000, SalesSum: 100000, DebitSum: 70000 }
      ]]])
    }),
    writeDetail: async () => {},
    writeSummary: async () => {},
    readDetail: async () => expectedDetail,
    readSummary: async () => expectedSummary.map((row, index) => index === 1 ? ['ИТОГО','',1,29999,100000,70000] : row)
  });

  const res = responseRecorder();
  await handler({ method: 'GET' }, res);

  assert.equal(res.statusCode, 502);
  assert.deepEqual(res.body, { ok: false, error: 'Receivables staging verification failed' });
});

test('receivables sync rejects non-GET without external calls', async () => {
  let calls = 0;
  const handler = createReceivablesSyncHandler({
    fetchCurrent: async () => { calls += 1; return { groups: [], contractsByGroup: new Map() }; },
    writeDetail: async () => {},
    writeSummary: async () => {},
    readDetail: async () => [],
    readSummary: async () => []
  });

  const res = responseRecorder();
  await handler({ method: 'POST' }, res);

  assert.equal(res.statusCode, 405);
  assert.equal(calls, 0);
});

test('receivables sync returns generic 500 without leaking ASHK details', async () => {
  const handler = createReceivablesSyncHandler({
    fetchCurrent: async () => { throw new Error('private student or ASHK detail'); },
    writeDetail: async () => {},
    writeSummary: async () => {},
    readDetail: async () => [],
    readSummary: async () => []
  });

  const res = responseRecorder();
  await handler({ method: 'GET' }, res);

  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { ok: false, error: 'Receivables sync failed' });
});
