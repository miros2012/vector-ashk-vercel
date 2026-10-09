import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAshkSaleArchive,
  createAshkSaleArchiveEvidence,
  validateAshkSaleArchivePeriod,
  verifyAshkSaleArchive
} from '../lib/ashk-sale-archive.js';

const period = { startDate: '2026-09-01', endDate: '2026-09-30' };

function sale(overrides = {}) {
  return {
    Id: 'sale-1', Date: '2026-09-01T08:00:00', EmployeeName: 'Менеджер',
    StudentOwnerName: 'Курсант', StudentId: 11, ProductName: 'Курс',
    Sum: 5000, Paid: 3000, ...overrides
  };
}

test('historical sale archive accepts only September 2026', () => {
  assert.deepEqual(validateAshkSaleArchivePeriod(period), { ...period, dayCount: 30 });
  assert.throws(
    () => validateAshkSaleArchivePeriod({ startDate: '2026-10-01', endDate: '2026-10-31' }),
    /invalid sale archive period/
  );
});

test('historical sale archive keeps immutable facts, deduplicates identical IDs and checks source count', async () => {
  const requests = [];
  const archive = await buildAshkSaleArchive({
    ...period,
    session: {
      async requestJson(path, params) {
        requests.push({ path, params });
        return {
          success: true,
          total_count: 3,
          data: [
            sale({ Id: 'sale-2', Date: '2026-09-30T23:59:59', Sum: 7000, Paid: 7000 }),
            sale(),
            sale()
          ]
        };
      }
    }
  });

  assert.deepEqual(requests, [{
    path: '/api/SaleList',
    params: {
      Period: 'Custom', StartDate: '2026-09-01', EndDate: '2026-09-30',
      IncludeWalletSales: false, start: 0, count: 500
    }
  }]);
  assert.deepEqual(archive.summary, {
    sourceRows: 3,
    rows: 2,
    sum: 12000,
    paid: 10000,
    unpaid: 2000,
    firstSaleDate: '2026-09-01T08:00:00',
    lastSaleDate: '2026-09-30T23:59:59'
  });
  assert.deepEqual(archive.sales.map(item => item.Id), ['sale-1', 'sale-2']);
  assert.match(archive.sha256, /^[a-f0-9]{64}$/);
});

test('historical sale archive paginates to a stable trustworthy total_count', async () => {
  const requests = [];
  const pages = [
    { total_count: 3, data: [sale({ Id: 'sale-1' }), sale({ Id: 'sale-2' })] },
    { total_count: 3, data: [sale({ Id: 'sale-3' })] }
  ];
  const archive = await buildAshkSaleArchive({
    ...period,
    pageSize: 2,
    session: {
      async requestJson(path, params) {
        requests.push({ path, params });
        return pages.shift();
      }
    }
  });

  assert.deepEqual(requests.map(call => call.params.start), [0, 2]);
  assert.equal(archive.summary.sourceRows, 3);
  assert.equal(archive.summary.rows, 3);
});

test('historical sale archive fails closed on conflicting IDs, incomplete count and out-of-period rows', async () => {
  for (const response of [
    { total_count: 2, data: [sale(), sale({ Sum: 9000 })] },
    { total_count: 2, data: [sale()] },
    { total_count: 1, data: [sale({ Date: '2026-10-01T00:00:00' })] }
  ]) {
    await assert.rejects(
      buildAshkSaleArchive({
        ...period,
        session: { async requestJson() { return { success: true, ...response }; } }
      }),
      /conflicting ASHK sale ID|incomplete ASHK sale archive|outside archive period/
    );
  }
});

test('historical sale archive rejects missing, malformed, negative and changing total_count', async () => {
  for (const response of [
    { data: [sale()] },
    { total_count: 'unknown', data: [sale()] },
    { total_count: -1, data: [sale()] }
  ]) {
    await assert.rejects(
      buildAshkSaleArchive({
        ...period,
        session: { async requestJson() { return response; } }
      }),
      /trustworthy total_count/
    );
  }

  let page = 0;
  await assert.rejects(
    buildAshkSaleArchive({
      ...period,
      pageSize: 1,
      session: {
        async requestJson() {
          page += 1;
          return page === 1
            ? { total_count: 2, data: [sale({ Id: 'sale-1' })] }
            : { total_count: 3, data: [sale({ Id: 'sale-2' })] };
        }
      }
    }),
    /total_count changed/
  );
});

test('historical sale archive rejects malformed timestamps with valid date prefixes', () => {
  for (const Date of ['2026-09-01garbage', '2026-09-01T25:00:00', '2026-09-31T08:00:00']) {
    assert.throws(
      () => createAshkSaleArchiveEvidence({ period, sourceRows: 1, sales: [sale({ Date })] }),
      /invalid Date/
    );
  }
});

test('historical sale archive rejects missing money and verifier detects tampering', async () => {
  await assert.rejects(
    buildAshkSaleArchive({
      ...period,
      session: { async requestJson() { return { total_count: 1, data: [sale({ Paid: undefined })] }; } }
    }),
    /invalid sale money fact/
  );

  const evidence = createAshkSaleArchiveEvidence({
    period: validateAshkSaleArchivePeriod(period),
    sourceRows: 1,
    sales: [sale()]
  });
  assert.deepEqual(verifyAshkSaleArchive(evidence), evidence);
  assert.throws(
    () => verifyAshkSaleArchive({ ...evidence, summary: { ...evidence.summary, sum: 1 } }),
    /sale archive evidence mismatch/
  );
});
