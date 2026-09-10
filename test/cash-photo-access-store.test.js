import test from 'node:test';
import assert from 'node:assert/strict';
import { createCashPhotoAccessStore } from '../lib/cash-photo-access-store.js';

function sheetsWithRows(rows) {
  return {
    spreadsheets: {
      values: {
        async get(args) {
          assert.equal(args.range, "'Доступ мобильной загрузки'!A2:I");
          return { data: { values: rows } };
        }
      }
    }
  };
}

test('authorizes active branch by opaque token and derives branch server-side', async () => {
  const store = createCashPhotoAccessStore({
    sheets: sheetsWithRows([
      ['BRANCH:ЯМСКАЯ', 'Филиал', 'Ямская', 'Ямская', 'TRUE', '', '', '2', 'opaque-yamskaya']
    ]),
    spreadsheetId: 'sheet'
  });
  assert.deepEqual(await store.authorize('opaque-yamskaya'), {
    accessId: 'BRANCH:ЯМСКАЯ', role: 'Филиал', branch: 'Ямская', label: 'Ямская'
  });
});

test('rejects inactive, non-branch, blank and unknown tokens', async () => {
  const store = createCashPhotoAccessStore({
    sheets: sheetsWithRows([
      ['BRANCH:OLD', 'Филиал', 'Old', 'Old', 'FALSE', '', '', '1', 'inactive'],
      ['PERSON:X', 'Подотчёт', 'X', '', 'TRUE', '', '', '2', 'person']
    ]),
    spreadsheetId: 'sheet'
  });
  assert.equal(await store.authorize('inactive'), null);
  assert.equal(await store.authorize('person'), null);
  assert.equal(await store.authorize('unknown'), null);
  assert.equal(await store.authorize(''), null);
});
