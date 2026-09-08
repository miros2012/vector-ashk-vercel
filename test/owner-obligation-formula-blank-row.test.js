import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

async function loadModule() {
  return import('../lib/owner-live-source-reader.js');
}

test('formula-only zero rows are not obligations, while incomplete business rows remain visible to fail closed', async () => {
  const module = await loadModule();
  assert.equal(typeof module.isMeaningfulObligationRow, 'function');

  const formulaBlank = Array(17).fill(null);
  formulaBlank[5] = 0;
  formulaBlank[16] = 0;
  assert.equal(module.isMeaningfulObligationRow(formulaBlank), false);

  const fullyBlank = Array(17).fill('');
  assert.equal(module.isMeaningfulObligationRow(fullyBlank), false);

  const realRow = Array(17).fill(null);
  realRow[1] = 'Аренда';
  realRow[7] = 'Прогноз';
  realRow[13] = 'RENT-1';
  realRow[16] = 45000;
  assert.equal(module.isMeaningfulObligationRow(realRow), true);

  const malformedButReal = Array(17).fill(null);
  malformedButReal[3] = 5000;
  assert.equal(module.isMeaningfulObligationRow(malformedButReal), true);
});

test('obligation parser uses the formula-empty row guard instead of generic non-empty detection', async () => {
  const source = await fs.readFile(new URL('../lib/owner-live-source-reader.js', import.meta.url), 'utf8');
  assert.match(source, /values\.slice\(1\)[\s\S]*?\.filter\(row\s*=>\s*isMeaningfulObligationRow\(row\)\)/);
});
