export default async function verifySyncHoursPreview(req, res) {
  const cronSecretConfigured = Boolean(String(process.env.CRON_SECRET || '').trim());
  const manualSyncConfigured = Boolean(String(process.env.VECTOR_SYNC_KEY || process.env.TOCHKA_BRIDGE_KEY || '').trim());

  return res.status(200).json({
    ok: true,
    cronSecretConfigured,
    manualSyncConfigured,
    writesPerformed: false
  });
}
