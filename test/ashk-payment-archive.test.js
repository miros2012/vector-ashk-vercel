import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAshkPaymentArchive,
  validateAshkPaymentArchivePeriod
} from '../lib/ashk-payment-archive.js';

function ashkResponse(rows, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify({ success: true, data: rows });
    }
  };
}

test('historical payment archive accepts one bounded calendar month only', () => {
  assert.deepEqual(
    validateAshkPaymentArchivePeriod({
      startDate: '2026-09-01',
      endDate: '2026-09-30'
    }),
    {
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      dayCount: 30
    }
  );
  assert.throws(
    () => validateAshkPaymentArchivePeriod({ startDate: '01.09.2026', endDate: '2026-09-30' }),
    /invalid archive period/
  );
  assert.throws(
    () => validateAshkPaymentArchivePeriod({ startDate: '2026-09-30', endDate: '2026-09-01' }),
    /invalid archive period/
  );
  assert.throws(
    () => validateAshkPaymentArchivePeriod({ startDate: '2026-08-01', endDate: '2026-09-30' }),
    /invalid archive period/
  );
});

test('historical payment archive keeps signed refunds, batches the source and deduplicates stable IDs', async () => {
  const requests = [];
  const pages = [
    [
      { Id: 'pay-2', PayDate: '2026-09-02T09:00:00', StudentId: 22, SaleId: 202, ProductId: 2, ProductName: 'B', SaleSum: 7000, Debit: -2700 },
      { Id: 'pay-1', PayDate: '2026-09-01T08:00:00', StudentId: 11, SaleId: 101, ProductId: 1, ProductName: 'A', SaleSum: 5000, Debit: 5000 }
    ],
    [
      { Id: 'pay-2', PayDate: '2026-09-02T09:00:00', StudentId: 22, SaleId: 202, ProductId: 2, ProductName: 'B', SaleSum: 7000, Debit: -2700 },
      { Id: 'pay-3', PayDate: '2026-09-14T10:00:00', StudentId: 33, SaleId: 303, ProductId: 3, ProductName: 'C', SaleSum: 10000, Debit: 10000 }
    ],
    [],
    [],
    [{ Id: 'pay-4', PayDate: '2026-09-30T23:59:59', StudentId: 44, SaleId: 404, ProductId: 4, ProductName: 'D', SaleSum: 1500, Debit: 1500 }]
  ];
  const archive = await buildAshkPaymentArchive({
    startDate: '2026-09-01',
    endDate: '2026-09-30',
    apiKey: 'private-key',
    fetchFn: async (url, options) => {
      requests.push({ url: String(url), options });
      return ashkResponse(pages[requests.length - 1]);
    },
    sleep: async () => {}
  });

  assert.equal(requests.length, 5);
  assert.match(requests[0].url, /StartDate=2026-09-01T00%3A00%3A00/);
  assert.match(requests[0].url, /EndDate=2026-09-07T23%3A59%3A59/);
  assert.match(requests[4].url, /StartDate=2026-09-29T00%3A00%3A00/);
  assert.match(requests[4].url, /EndDate=2026-09-30T23%3A59%3A59/);
  assert.equal(requests[0].options.headers.api_key, 'private-key');
  assert.deepEqual(archive.period, {
    startDate: '2026-09-01',
    endDate: '2026-09-30',
    dayCount: 30
  });
  assert.deepEqual(archive.summary, {
    rows: 4,
    positive: 16500,
    refunds: 2700,
    net: 13800,
    firstPayDate: '2026-09-01T08:00:00',
    lastPayDate: '2026-09-30T23:59:59'
  });
  assert.deepEqual(archive.payments.map(item => [item.Id, item.Debit]), [
    ['pay-1', 5000],
    ['pay-2', -2700],
    ['pay-3', 10000],
    ['pay-4', 1500]
  ]);
  assert.match(archive.sha256, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(archive).includes('private-key'), false);
});

test('historical payment archive fails closed when one ID has conflicting source facts', async () => {
  let requestCount = 0;
  await assert.rejects(
    buildAshkPaymentArchive({
      startDate: '2026-09-01',
      endDate: '2026-09-08',
      apiKey: 'private-key',
      fetchFn: async () => {
        requestCount += 1;
        return ashkResponse(requestCount === 1
          ? [{ Id: 'same-id', PayDate: '2026-09-01T08:00:00', Debit: 5000 }]
          : [{ Id: 'same-id', PayDate: '2026-09-01T08:00:00', Debit: 7000 }]);
      },
      sleep: async () => {}
    }),
    /conflicting ASHK payment ID/
  );
});

test('historical payment archive rejects source rows outside the requested period', async () => {
  await assert.rejects(
    buildAshkPaymentArchive({
      startDate: '2026-09-01',
      endDate: '2026-09-01',
      apiKey: 'private-key',
      fetchFn: async () => ashkResponse([
        { Id: 'late-row', PayDate: '2026-10-01T00:00:00', Debit: 5000 }
      ]),
      sleep: async () => {}
    }),
    /outside archive period/
  );
});
