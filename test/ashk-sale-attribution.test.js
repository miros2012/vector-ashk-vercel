import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attributePaymentsToSales,
  createAshkSaleSource,
  normalizeSaleId,
  summarizeSaleStaffCandidates
} from '../lib/ashk-sale-attribution.js';

test('normalizes numeric SaleId without fuzzy matching', () => {
  assert.equal(normalizeSaleId(' 00123 '), '123');
  assert.equal(normalizeSaleId('sale-123'), 'sale-123');
  assert.equal(normalizeSaleId(null), '');
});

test('attributes payment only through matching SaleId and sale employee', () => {
  const result = attributePaymentsToSales([
    { Id: 1, SaleId: 77, StudentId: 10, Debit: 15100 }
  ], [
    { Id: 77, EmployeeName: 'Шумилова Полина', StudentOwnerName: 'Другой сотрудник' }
  ]);
  assert.equal(result.items[0].SaleEmployeeName, 'Шумилова Полина');
  assert.equal(result.items[0].SaleAttributionStatus, 'OK_SALE_EMPLOYEE');
  assert.deepEqual(result.metrics, {
    total: 1,
    attributed: 1,
    saleIdEmpty: 0,
    saleNotFound: 0,
    employeeEmpty: 0
  });
});

test('does not fall back to owner or cashbox employee', () => {
  const result = attributePaymentsToSales([
    { Id: 1, SaleId: 77, PaymentEmployeeName: 'Кассир' }
  ], [
    { Id: 77, EmployeeName: '', StudentOwnerName: 'Ответственный' }
  ]);
  assert.equal(result.items[0].SaleEmployeeName, '');
  assert.equal(result.items[0].SaleAttributionStatus, 'SALE_EMPLOYEE_EMPTY');
});

test('reports empty and unknown SaleId without guessing', () => {
  const result = attributePaymentsToSales([
    { Id: 1, SaleId: '' },
    { Id: 2, SaleId: 999 }
  ], []);
  assert.deepEqual(result.items.map(item => item.SaleAttributionStatus), [
    'SALE_ID_EMPTY',
    'SALE_NOT_FOUND'
  ]);
  assert.deepEqual(result.metrics, {
    total: 2,
    attributed: 0,
    saleIdEmpty: 1,
    saleNotFound: 1,
    employeeEmpty: 0
  });
});

test('sale staff diagnostic aggregates payment debit by every staff-like sale field', () => {
  const result = summarizeSaleStaffCandidates([
    { SaleId: 77, Debit: 100 },
    { SaleId: 77, Debit: 50 },
    { SaleId: 88, Debit: 20 },
    { SaleId: 999, Debit: 999 }
  ], [
    {
      Id: 77,
      EmployeeName: 'Продавец',
      StudentOwnerName: 'Ответственный',
      CreatorName: 'Создатель',
      Comment: 'Не персонал'
    },
    {
      Id: 88,
      EmployeeName: 'Другой продавец',
      StudentOwnerName: 'Ответственный',
      CreatorName: 'Создатель 2'
    }
  ]);

  assert.deepEqual(result.fields, ['CreatorName', 'EmployeeName', 'StudentOwnerName']);
  assert.deepEqual(result.totals.EmployeeName, [
    { name: 'Другой продавец', amount: 20 },
    { name: 'Продавец', amount: 150 }
  ]);
  assert.deepEqual(result.totals.StudentOwnerName, [
    { name: 'Ответственный', amount: 170 }
  ]);
  assert.deepEqual(result.totals.CreatorName, [
    { name: 'Создатель', amount: 150 },
    { name: 'Создатель 2', amount: 20 }
  ]);
  assert.equal(result.unresolvedPayments, 1);
  assert.equal(result.unresolvedAmount, 999);
});

test('loads period sales and resolves older referenced sales through SaleGet', async () => {
  const calls = [];
  const session = {
    requestJson: async (path, params) => {
      calls.push({ path, params });
      if (path === '/api/SaleList') {
        return { data: [{ Id: 77, EmployeeName: 'Шумилова Полина', Date: '2026-09-02' }] };
      }
      assert.equal(params.param, '55');
      return { data: { Id: 55, EmployeeName: 'Кузнецова Марина', Date: '2026-08-10' } };
    }
  };
  const source = createAshkSaleSource({ session, concurrency: 2 });
  const result = await source.fetchForPayments({
    payments: [{ SaleId: 77 }, { SaleId: 55 }, { SaleId: 55 }],
    startDate: '2026-09-01',
    endDate: '2026-09-03'
  });
  assert.deepEqual(result.sales.map(item => item.Id).sort(), [55, 77]);
  assert.equal(calls.filter(call => call.path === '/api/SaleGet').length, 1);
  assert.deepEqual(calls[0], {
    path: '/api/SaleList',
    params: {
      Period: 'Custom',
      StartDate: '2026-09-01',
      EndDate: '2026-09-03',
      IncludeWalletSales: false
    }
  });
  assert.deepEqual(result.metrics, {
    periodSales: 1,
    referencedSaleIds: 2,
    detailRequests: 1,
    resolvedSales: 2
  });
});
