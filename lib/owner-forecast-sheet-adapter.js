import { parseOwnerForecastSheetValues } from './owner-forecast-sheet-parser.js';

const OWNER_FORECAST_RANGE = "'Прогноз 30 дней'!A1:R34";

export function createOwnerForecastSheetAdapter({ sheets, spreadsheetId }) {
  return {
    async readOwnerForecast() {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: OWNER_FORECAST_RANGE,
        valueRenderOption: 'UNFORMATTED_VALUE'
      });
      return parseOwnerForecastSheetValues(response.data.values);
    }
  };
}
