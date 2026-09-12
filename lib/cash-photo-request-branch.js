// Existing branch credentials remain pinned. Shared credentials can select only
// branches explicitly returned by the private active-branch registry.
export function cashPhotoRequestBranch(credential, req) {
  if (credential?.branch) return String(credential.branch).trim();
  if (credential?.role !== 'Сотрудники' || !Array.isArray(credential.branches)) return '';
  try {
    const selected = decodeURIComponent(String(req?.headers?.['x-cash-branch'] || '')).trim();
    return credential.branches.some(item => item.branch === selected) ? selected : '';
  } catch { return ''; }
}
