import test from 'node:test';
import assert from 'node:assert/strict';
import { createReceivablesSyncHandler } from '../lib/receivables-sync-handler.js';

function responseRecorder() {
  return {
    statusCode: 200,
    body: undefined,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

const groups = [{ Id: 10, TrainingRoomName: 'Зарека' }];
const contractsByGroup = new Map([[10, [
  { Id: 101, OwnerName: 'Менеджер', Debt: 30000, SalesSum: 100000, DebitSum: 70000 }
]]]);

function detail() {
  return [
    ['StudentId','GroupId','Филиал','Менеджер','Договор','Дата договора','Статус','Продажи','Оплачено','Долг','Долг основной услуги','Основная услуга','Последняя оплата'],
    [101,10,'Зарека','Менеджер','','','',100000,70000,30000,0,'','']
  ];
}
function summary() {
  return [
    ['Тип','Объект','Договоров','Долг','Продажи','Оплачено'],
    ['ИТОГО','',1,30000,100000,70000]
  ];
}

test('receivables sync calls afterVerified with the already-fetched raw ASHK contracts only after readback passes', async () => {
  let hookPayload;
  const handler = createReceivablesSyncHandler({
    fetchCurrent: async () => ({ groups, contractsByGroup }),
    writeDetail: async () => {},
    writeSummary: async () => {},
    readDetail: async () => detail(),
    readSummary: async () => summary(),
    afterVerified: async payload => { hookPayload = payload; return { ok: true, controlRows: 2 }; }
  });
  const res = responseRecorder();
  await handler({ method: 'GET' }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(hookPayload.groups, groups);
  assert.equal(hookPayload.contractsByGroup, contractsByGroup);
  assert.equal(hookPayload.summary.total.debt, 30000);
  assert.deepEqual(res.body.afterVerified, { ok: true, controlRows: 2 });
});

test('receivables sync never calls afterVerified when staging readback fails', async () => {
  let hookCalls = 0;
  const handler = createReceivablesSyncHandler({
    fetchCurrent: async () => ({ groups, contractsByGroup }),
    writeDetail: async () => {},
    writeSummary: async () => {},
    readDetail: async () => detail(),
    readSummary: async () => [['Тип','Объект','Договоров','Долг','Продажи','Оплачено'],['ИТОГО','',1,29999,100000,70000]],
    afterVerified: async () => { hookCalls += 1; }
  });
  const res = responseRecorder();
  await handler({ method: 'GET' }, res);

  assert.equal(res.statusCode, 502);
  assert.equal(hookCalls, 0);
});
