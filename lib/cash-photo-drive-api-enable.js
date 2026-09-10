const DRIVE_ENABLE_URL = 'https://serviceusage.googleapis.com/v1/projects/798693414461/services/drive.googleapis.com:enable';

export async function enableCashPhotoDriveApi({ auth } = {}) {
  if (!auth || typeof auth.request !== 'function') {
    throw new Error('Google auth client is required');
  }
  const response = await auth.request({
    url: DRIVE_ENABLE_URL,
    method: 'POST'
  });
  const operation = String(response?.data?.name || '').trim();
  if (!operation) throw new Error('Google Service Usage did not return an operation');
  return { ok: true, operation };
}
