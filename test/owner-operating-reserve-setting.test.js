import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function loadReader() {
  try {
    const module = await import('../lib/owner-live-source-reader.js');
    return module.readOwnerOperatingReserve;
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') return undefined;
    throw error;
  }
}

function sheetsFor(values) {
  const calls = [];
  return {
    calls,
    sheets: {
      spreadsheets: {
        values: {
          async get(args) {
            calls.push(structuredClone(args));
            return { data: { values } };
          }
        }
      }
    }
  };
}

test('reads one approved operating reserve from the bounded settings range', async () => {
  const readOwnerOperatingReserve = await loadReader();
  assert.equal(typeof readOwnerOperatingReserve, 'function');
  const { sheets, calls } = sheetsFor([
    ['Параметр', 'Значение'],
    ['Операционный резерв', 550000, 'Подтверждено собственником'],
    ['Другое', 123]
  ]);

  const result = await readOwnerOperatingReserve({ sheets, spreadsheetId: 'sheet-123' });

  assert.equal(result, 550000);
  assert.deepEqual(calls, [{
    spreadsheetId: 'sheet-123',
    range: "'Настройки системы'!A1:C40",
    valueRenderOption: 'UNFORMATTED_VALUE'
  }]);
});

test('fails closed to undefined when reserve setting is missing, duplicated, non-numeric, or negative', async () => {
  const readOwnerOperatingReserve = await loadReader();
  assert.equal(typeof readOwnerOperatingReserve, 'function');
  const cases = [
    [['Параметр', 'Значение']],
    [['Операционный резерв', 550000], ['Операционный резерв', 600000]],
    [['Операционный резерв', '550000']],
    [['Операционный резерв', -1]],
    [['Операционный резерв', Number.NaN]]
  ];

  for (const values of cases) {
    const { sheets } = sheetsFor(values);
    assert.equal(
      await readOwnerOperatingReserve({ sheets, spreadsheetId: 'sheet-123' }),
      undefined
    );
  }
});

test('Owner package wiring reads the setting and passes it to the existing live package policy', async () => {
  const source = await readFile(new URL('../api/decision-event.js', import.meta.url), 'utf8');
  assert.match(source, /readOwnerOperatingReserve/);
  assert.match(source, /buildOwnerLivePackage\(\{[\s\S]*?operatingReserve(?:\s*,|\s*:\s*operatingReserve)/);
  assert.doesNotMatch(source, /550000|550_000/);
});
