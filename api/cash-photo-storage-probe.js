import { google } from 'googleapis';
import { getVercelOidcToken } from '@vercel/oidc';

const SPREADSHEET_ID = process.env.CASH_PHOTO_SPREADSHEET_ID || '1HuTTbdJ2kmnjMH14O0OQZHQBGsOsBtCPXqT--nngD10';
const PHOTO_FOLDER_ID = process.env.CASH_PHOTO_DRIVE_FOLDER_ID || '1PHTv_r47ZEbnH76I7zbC5YgphpELpkfG';

function privateKey() {
  return String(process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  try {
    if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
      throw new Error('Google service account secrets missing');
    }
    const auth = new google.auth.JWT({
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: privateKey(),
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets.readonly',
        'https://www.googleapis.com/auth/drive.readonly'
      ]
    });
    await auth.authorize();
    const sheets = google.sheets({ version: 'v4', auth });
    const drive = google.drive({ version: 'v3', auth });

    const [driveProbe] = await Promise.all([
      drive.files.get({
        fileId: PHOTO_FOLDER_ID,
        fields: 'id,capabilities(canAddChildren)',
        supportsAllDrives: true
      }),
      sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: "'Архив кассовых фото'!A1:N1"
      })
    ]);
    const oidcToken = await getVercelOidcToken();

    return res.status(200).json({
      ok: true,
      driveFolderAccessible: true,
      driveCanAddChildren: Boolean(driveProbe?.data?.capabilities?.canAddChildren),
      photoArchiveAccessible: true,
      aiGatewayOidcAvailable: Boolean(oidcToken || process.env.AI_GATEWAY_API_KEY),
      cronSecretConfigured: Boolean(process.env.CRON_SECRET)
    });
  } catch (error) {
    console.error('cash photo storage probe failed', error);
    return res.status(503).json({
      ok: false,
      driveFolderAccessible: false,
      photoArchiveAccessible: false,
      aiGatewayOidcAvailable: false
    });
  }
}
