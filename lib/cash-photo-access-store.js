function isActive(value) {
  if (value === true) return true;
  return ['TRUE', '1', 'YES', 'ДА'].includes(String(value || '').trim().toUpperCase());
}

export function createCashPhotoAccessStore({ sheets, spreadsheetId } = {}) {
  if (!sheets?.spreadsheets?.values) throw new Error('Google Sheets client is required');
  if (!spreadsheetId) throw new Error('Spreadsheet id is required');

  return {
    async authorize(token) {
      const normalizedToken = String(token || '').trim();
      if (!normalizedToken) return null;

      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: "'Доступ мобильной загрузки'!A2:I"
      });
      const rows = response?.data?.values || [];
      for (const row of rows) {
        if (String(row?.[8] || '').trim() !== normalizedToken) continue;
        if (!isActive(row?.[4])) return null;
        if (String(row?.[1] || '').trim() !== 'Филиал') return null;
        const branch = String(row?.[3] || '').trim();
        if (!branch) return null;
        return {
          accessId: String(row?.[0] || '').trim(),
          role: 'Филиал',
          branch,
          label: String(row?.[2] || branch).trim()
        };
      }
      return null;
    }
  };
}
