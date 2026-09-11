// User OAuth owns new files. Service-account Drive is retained only as a reader.
export function createCashPhotoDriveWriter({ google, env = process.env } = {}) {
  const clientId = String(env.CASH_PHOTO_DRIVE_CLIENT_ID || '').trim();
  const clientSecret = String(env.CASH_PHOTO_DRIVE_CLIENT_SECRET || '').trim();
  const refreshToken = String(env.CASH_PHOTO_DRIVE_REFRESH_TOKEN || '').trim();
  const configured = Boolean(clientId && clientSecret && refreshToken);
  let drive;
  if (configured) {
    // OAuth2's refresh code forces retry:true; the nested zero is required too.
    const auth = new google.auth.OAuth2({ clientId, clientSecret, transporterOptions: { timeout: 10000, retry: false, retryConfig: { retry: 0 } } });
    auth.setCredentials({ refresh_token: refreshToken });
    drive = google.drive({ version: 'v3', auth });
  }
  return {
    configured,
    files: {
      async create(args) {
        if (!drive) throw new Error('Cash photo Drive is not configured');
        try {
          return await drive.files.create(args, { timeout: 15000, retry: false });
        } catch {
          // googleapis errors can carry Authorization headers and refresh credentials.
          throw new Error('Cash photo Drive upload failed');
        }
      }
    },
    async probe(folderId) {
      if (!drive) return { ok: false, configured, reason: 'oauth_not_configured' };
      try {
        const { data } = await drive.files.get({
          fileId: folderId,
          fields: 'id,mimeType,ownedByMe,capabilities(canAddChildren)',
          supportsAllDrives: true
        }, { timeout: 5000, retry: false });
        const ok = data?.mimeType === 'application/vnd.google-apps.folder'
          && data?.ownedByMe === true && data?.capabilities?.canAddChildren === true;
        return { ok, configured, ...(ok ? {} : { reason: 'upload_folder_unavailable' }) };
      } catch {
        return { ok: false, configured, reason: 'upload_folder_unavailable' };
      }
    }
  };
}
