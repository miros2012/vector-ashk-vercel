import { readFile, access } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { google } from 'googleapis';
import { startCashPhotoConsent, provisionCashPhotoFolder, saveCashPhotoSecrets, buildCashPhotoAccess } from '../lib/cash-photo-setup.js';

async function main() {
  const { values } = parseArgs({ options: { client: { type: 'string' }, out: { type: 'string' }, help: { type: 'boolean' } } });
  if (values.help || !values.client || !values.out) {
    console.log('Usage: node scripts/setup-cash-photo-drive.js --client /path/oauth-desktop.json --out /path/new-private-directory');
    return;
  }
  const directory = resolve(values.out);
  const repo = fileURLToPath(new URL('..', import.meta.url));
  const rel = relative(repo, directory);
  if (!rel.startsWith('..')) throw new Error('Choose an output directory outside the repository');
  try { await access(directory); throw new Error('Output directory already exists; choose a new directory'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const credentials = JSON.parse(await readFile(resolve(values.client), 'utf8')).installed;
  if (!credentials?.client_id || !credentials?.client_secret) throw new Error('A Google Desktop OAuth client JSON file is required');
  const auth = new google.auth.OAuth2({ clientId: credentials.client_id, clientSecret: credentials.client_secret, transporterOptions: { timeout: 15000, retry: false, retryConfig: { retry: 0 } } });
  const flow = await startCashPhotoConsent({ auth });
  try {
    console.log('Откройте эту ссылку в браузере на этом компьютере и выберите Google-аккаунт владельца фото:');
    console.log(flow.url); // Public client ID, random CSRF state and PKCE challenge only.
    const tokens = await flow.result;
    auth.setCredentials(tokens);
    const drive = google.drive({ version: 'v3', auth });
    const folderId = await provisionCashPhotoFolder({ drive, serviceAccountEmail: 'vector-ashk-backend@vector-finance-ai.iam.gserviceaccount.com' });
    const branches = ['Герцена', 'Ямская', 'Зарека', 'Мельникайте', 'Сити-молл', 'Республика', 'Монтажников', 'Салманова', 'Гондатти']
      .map(branch => ({ accessId: `BRANCH:${branch.toUpperCase()}`, branch, label: branch }));
    const { registry, links } = buildCashPhotoAccess(branches);
    await saveCashPhotoSecrets({ directory, env: {
      CASH_PHOTO_DRIVE_CLIENT_ID: credentials.client_id,
      CASH_PHOTO_DRIVE_CLIENT_SECRET: credentials.client_secret,
      CASH_PHOTO_DRIVE_REFRESH_TOKEN: tokens.refresh_token,
      CASH_PHOTO_DRIVE_FOLDER_ID: folderId,
      CASH_PHOTO_ACCESS_JSON: JSON.stringify(registry)
    }, links });
    console.log('Готово: в указанной закрытой папке созданы vercel.env и branch-links.txt. Не отправляйте их в чат или GitHub.');
    console.log('Импортируйте vercel.env в Production environment variables проекта vector-ashk-backend и выполните Redeploy.');
  } finally { await flow.close(); }
}

main().catch(() => {
  // Raw Google/JSON errors may include credentials. Keep terminal output fixed.
  console.error('Подключение не завершено. Проверьте Desktop OAuth JSON, согласие Google и новый путь вне репозитория. Секреты не выведены.');
  process.exitCode = 1;
});
