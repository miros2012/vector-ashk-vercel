import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateFinanceReports, refreshFinanceReports, verifyFinanceReports } from '../lib/finance-reports.js';
const row = (month, amount, article, pnl = '') => ['', month, 46260, amount, 1, '', '', '', article, '', 'Операционная', pnl, ''];
function input() {
  return { dds: [row(8, -100, 'Salary'), row(9, -20, 'Salary', 8), row(8, -10, 'Refund'), row(8, -5, 'Tax'), row(8, -7, 'Variable'), row(8, -999, 'Transfer')],
    directory: [['Статья','Вид деятельности','Учитывать в P&L','Фонд','Тип в P&L'], ['Salary','','Да','','Постоянные расходы'], ['Refund','','Да','','Уменьшение выручки'], ['Tax','','Да','','Налоги'], ['Variable','','Да','','Переменные расходы'], ['Transfer','','Нет','','Внутренние переводы']],
    revenue: [['Месяц','Месяц (цифрой)','Выручка'], ['Август',8,1000], ['Сентябрь',9,'']],
    layout: ['Выручка по начислению','Возвраты курсантам','Прочие операционные доходы','Чистая выручка','Переменные расходы','Валовая прибыль','Постоянные расходы','Налоги','Операционная прибыль','Рентабельность','Справочно: инвестиционный отток (нетто, ДДС)'] };
}
test('report transport failures are distinguished from invalid financial data',async()=>{
 const adapter={read:async()=>{throw Object.assign(Error('private response'),{response:{status:429}});}};
 assert.deepEqual(await refreshFinanceReports(adapter),{ok:false,errorClass:'REPORT_TRANSPORT'});
 adapter.read=async()=>{const source=input();source.dds[0][3]='invalid';return source;};
 assert.deepEqual(await refreshFinanceReports(adapter),{ok:false,errorClass:'REPORT_VALIDATION'});
});
test('canonical months, refunds and excluded transfers produce hand-checked P&L', () => {
  const result = calculateFinanceReports(input());
  assert.deepEqual(result.values.map(r => r[7]), [1000,10,0,990,7,983,120,5,858,858/990,0]);
  assert.equal(result.values[0][8], ''); assert.equal(result.values[8][8], '');
});
test('unknown classifications and conflicting directories block publication', () => {
  const a = input(); a.dds.push(row(8,-4,'Unknown'));
  assert.throws(() => calculateFinanceReports(a), /article/i);
  const b=input(); b.directory.push(['Salary','','Да','','Переменные расходы']);
  assert.throws(() => calculateFinanceReports(b), /directory/i);
});
test('blank sources, invalid amount, changed layout cannot erase a report', () => {
  for (const change of [a => {a.dds=[];}, a=>{a.dds[0][3]='broken';}, a=>{a.layout[0]='Other report';}]) {
    const a=input();change(a);assert.throws(()=>calculateFinanceReports(a));
  }
});
test('legacy paired cash collection is excluded only with matching date, purpose, distinct wallets and opposite amounts', () => {
  const a=input();const out=row(8,-50,'');out[4]=101;out[7]='Инкассация Вадим — перевод из Касса';
  const inc=row(8,50,'');inc[4]=202;inc[7]='Инкассация Вадим — поступление в Вадим';
  a.dds.push(out,inc);assert.equal(calculateFinanceReports(a).values[8][7],858);
  inc[3]=49;assert.throws(()=>calculateFinanceReports(a),/article/i);
});
test('report publishes with readback and refuses success when inputs race', async () => {
  const a=input(); let output;let reads=0;
  const adapter={read:async()=>{reads++; return a;},write:async v=>{output=v;},readOutput:async()=>output};
  assert.equal((await refreshFinanceReports(adapter)).ok,true);
  assert.equal(output[8][7],858);
  adapter.read=async()=>{reads++;const b=structuredClone(a);if(reads>3)b.dds[0][3]=-200;return b;};
  assert.equal((await refreshFinanceReports(adapter)).ok,false);
});

test('read-only verification rejects later DDS changes and overwritten report output',async()=>{
 const source=input(); const expected=calculateFinanceReports(source);let output=structuredClone(expected.values);
 const adapter={read:async()=>source,readOutput:async()=>output};
 assert.equal((await verifyFinanceReports(adapter,expected.fingerprint)).ok,true);
 source.dds[0][3]=-101;
 assert.equal((await verifyFinanceReports(adapter,expected.fingerprint)).ok,false);
 source.dds[0][3]=-100;output[8][7]=123;
 assert.equal((await verifyFinanceReports(adapter,expected.fingerprint)).ok,false);
});
