const STATUS_VALUES = [
  'НЕ СВЯЗАЛИСЬ','ДОЗВОНИЛИСЬ','ОБЕЩАНИЕ','ЧАСТИЧНАЯ ОПЛАТА','ОПЛАЧЕНО','ОТКАЗ/ЭСКАЛАЦИЯ'
];

function color(red, green, blue) {
  return { red: red / 255, green: green / 255, blue: blue / 255 };
}

function conditionalRule(sheetId, rowCount, formula, backgroundColor, index) {
  return {
    addConditionalFormatRule: {
      index,
      rule: {
        ranges: [{ sheetId, startRowIndex: 1, endRowIndex: rowCount, startColumnIndex: 0, endColumnIndex: 22 }],
        booleanRule: {
          condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: formula }] },
          format: { backgroundColor }
        }
      }
    }
  };
}

export function buildDebtorPriorityFormatRequests({ sheetId, rowCount = 500, existingConditionalRuleCount = 0 } = {}) {
  const id = Number(sheetId);
  const rows = Math.max(2, Number(rowCount) || 500);
  if (!Number.isInteger(id)) throw new Error('sheetId is required');
  const requests = [];
  for (let index = Number(existingConditionalRuleCount) - 1; index >= 0; index -= 1) {
    requests.push({ deleteConditionalFormatRule: { sheetId: id, index } });
  }
  requests.push(
    {
      updateSheetProperties: {
        properties: { sheetId: id, gridProperties: { frozenRowCount: 1 } },
        fields: 'gridProperties.frozenRowCount'
      }
    },
    {
      repeatCell: {
        range: { sheetId: id, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 22 },
        cell: {
          userEnteredFormat: {
            backgroundColor: color(217, 225, 242),
            textFormat: { bold: true },
            verticalAlignment: 'MIDDLE',
            wrapStrategy: 'WRAP'
          }
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,wrapStrategy)'
      }
    },
    {
      repeatCell: {
        range: { sheetId: id, startRowIndex: 1, endRowIndex: rows, startColumnIndex: 13, endColumnIndex: 22 },
        cell: { userEnteredFormat: { verticalAlignment: 'TOP', wrapStrategy: 'WRAP' } },
        fields: 'userEnteredFormat(verticalAlignment,wrapStrategy)'
      }
    },
    {
      setDataValidation: {
        range: { sheetId: id, startRowIndex: 1, endRowIndex: rows, startColumnIndex: 18, endColumnIndex: 19 },
        rule: {
          condition: { type: 'ONE_OF_LIST', values: STATUS_VALUES.map(userEnteredValue => ({ userEnteredValue })) },
          strict: true,
          showCustomUi: true
        }
      }
    },
    conditionalRule(id, rows, '=($A2<>"")*($S2="ОПЛАЧЕНО")', color(217, 234, 211), 0),
    conditionalRule(id, rows, '=($A2<>"")*(($S2="ОБЕЩАНИЕ")+($S2="ЧАСТИЧНАЯ ОПЛАТА"))', color(255, 242, 204), 1),
    conditionalRule(id, rows, '=($A2<>"")*(($S2="")+($S2="НЕ СВЯЗАЛИСЬ")+($S2="ОТКАЗ/ЭСКАЛАЦИЯ"))', color(244, 204, 204), 2)
  );
  const widths = [45,100,120,115,115,80,200,90,150,170,170,110,110,250,210,320,320,130,170,120,120,240];
  widths.forEach((pixelSize, index) => requests.push({
    updateDimensionProperties: {
      range: { sheetId: id, dimension: 'COLUMNS', startIndex: index, endIndex: index + 1 },
      properties: { pixelSize },
      fields: 'pixelSize'
    }
  }));
  return requests;
}

export async function formatDebtorPrioritySheet({ sheets, spreadsheetId, sheetName = 'РОП_Дебиторка_Приоритет' } = {}) {
  const metadata = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets(properties(sheetId,title,gridProperties(rowCount)),conditionalFormats)'
  });
  const sheet = (metadata.data.sheets || []).find(item => item.properties?.title === sheetName);
  if (!sheet) throw new Error(`Missing sheet: ${sheetName}`);
  const requests = buildDebtorPriorityFormatRequests({
    sheetId: sheet.properties.sheetId,
    rowCount: sheet.properties.gridProperties?.rowCount || 500,
    existingConditionalRuleCount: Array.isArray(sheet.conditionalFormats) ? sheet.conditionalFormats.length : 0
  });
  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
}

export { STATUS_VALUES };
