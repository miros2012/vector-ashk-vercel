import { refreshFinanceReports, verifyFinanceReports } from './finance-reports.js';
import { boundedGoogleSheetsRequest } from './google-sheets-lease.js';

export function createFinanceReportsAdapter({sheets,spreadsheetId}) {
  const api=sheets.spreadsheets.values;
  const request=fn=>boundedGoogleSheetsRequest(fn,45000);
  return {
    async read(){
      const response=await request(options=>api.batchGet({spreadsheetId,
        ranges:["'ДДС: месяц'!A5:M30000","'Справочник статей'!A1:E1000","'Данные АШК'!A1:D100","'P&L'!A4:A14"],
        valueRenderOption:'UNFORMATTED_VALUE'},options));
      const ranges=response.data.valueRanges;
      return {dds:ranges[0].values||[],directory:ranges[1].values||[],revenue:ranges[2].values||[],layout:(ranges[3].values||[]).map(r=>r[0])};
    },
    write:values=>request(options=>api.update({spreadsheetId,range:"'P&L'!B4:M14",valueInputOption:'RAW',requestBody:{values}},options)),
    async readOutput(){return (await request(options=>api.get({spreadsheetId,range:"'P&L'!B4:M14",valueRenderOption:'UNFORMATTED_VALUE'},options))).data.values||[];}
  };
}
export async function refreshGoogleSheetsFinanceReports(options){return refreshFinanceReports(createFinanceReportsAdapter(options));}

export async function verifyGoogleSheetsFinanceReports(options,fingerprint){return verifyFinanceReports(createFinanceReportsAdapter(options),fingerprint);}
