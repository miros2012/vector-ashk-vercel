import test from 'node:test';
import assert from 'node:assert/strict';
import { createOwnerActionQueueSheetAdapter } from '../lib/owner-action-queue-sheet-adapter.js';

test('reads only READY commands from the bounded A:M queue contract', async () => {
  const calls = [];
  const sheets = { spreadsheets: { values: {
    async get(args) {
      calls.push(args);
      return { data: { values: [
        ['req-1','DEC-1','В работу','Не начато','Собственник','','','','','READY','','2026-09-02T05:00:00Z',''],
        ['req-2','DEC-2','Готово','В работе','Финансы','Готово','','','','SUCCESS','ok','2026-09-02T04:00:00Z','2026-09-02T04:05:00Z']
      ] } };
    }
  } } };

  const adapter = createOwnerActionQueueSheetAdapter({ sheets, spreadsheetId: 'sheet-1' });
  const commands = await adapter.readReadyCommands();

  assert.deepEqual(calls, [{
    spreadsheetId: 'sheet-1',
    range: "'Owner Action Queue'!A2:M200",
    valueRenderOption: 'UNFORMATTED_VALUE'
  }]);
  assert.equal(commands.length, 1);
  assert.equal(commands[0]._row, 2);
  assert.equal(commands[0].requestId, 'req-1');
  assert.equal(commands[0].commandStatus, 'READY');
});

test('writes only transport status, response, and processed timestamp', async () => {
  const writes = [];
  const sheets = { spreadsheets: { values: {
    async batchUpdate(args) { writes.push(args); return { data: {} }; }
  } } };
  const adapter = createOwnerActionQueueSheetAdapter({ sheets, spreadsheetId: 'sheet-1' });

  await adapter.markCommand(7, {
    commandStatus: 'SUCCESS',
    response: '{"ok":true}',
    processedAt: '2026-09-02T05:05:00.000Z'
  });

  assert.deepEqual(writes, [{
    spreadsheetId: 'sheet-1',
    requestBody: {
      valueInputOption: 'RAW',
      data: [
        { range: "'Owner Action Queue'!J7:K7", values: [['SUCCESS','{"ok":true}']] },
        { range: "'Owner Action Queue'!M7", values: [['2026-09-02T05:05:00.000Z']] }
      ]
    }
  }]);
});

test('rejects an invalid row before any queue write', async () => {
  let writes = 0;
  const adapter = createOwnerActionQueueSheetAdapter({
    sheets: { spreadsheets: { values: { batchUpdate: async () => { writes += 1; } } } },
    spreadsheetId: 'sheet-1'
  });

  await assert.rejects(() => adapter.markCommand(1, { commandStatus: 'ERROR' }), /rowNumber must be >= 2/);
  assert.equal(writes, 0);
});
