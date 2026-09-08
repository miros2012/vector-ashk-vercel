export function resolveOwnerPackageKey(env = process.env) {
  const ownerKey = String(env?.VECTOR_OWNER_PACKAGE_KEY || '').trim();
  if (!ownerKey) return '';

  const syncKey = String(env?.VECTOR_SYNC_KEY || '').trim();
  const bridgeKey = String(env?.TOCHKA_BRIDGE_KEY || '').trim();
  if ((syncKey && ownerKey === syncKey) || (bridgeKey && ownerKey === bridgeKey)) return '';

  return ownerKey;
}
