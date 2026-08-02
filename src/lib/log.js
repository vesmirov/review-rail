export function hintForStatus(status) {
  if (status === 0) return 'GitLab is unreachable — check your VPN or the GitLab URL';
  if (status === 401) return 'Token is invalid or expired — click Reset token in the extension settings';
  if (status === 403) return 'Access denied — the token may lack the read_api scope or project access';
  if (status === 404) return 'Endpoint not found — the MR may be gone or your GitLab version is too old';
  if (status === 429) return 'Rate limited by GitLab — the next sync will retry automatically';
  if (status >= 500) return 'GitLab server error — likely temporary';
  return null;
}

export function normalizeApiPath(path) {
  return String(path)
    .split('?')[0]
    .replace(/\/\d+(?=\/|$)/g, '/:id');
}

export function apiErrorEntry(err, now = Date.now()) {
  const status = err.status || 0;
  const statusText = status === 0 ? 'network error' : String(status);
  const detailParts = [];
  if (err.path) detailParts.push(String(err.path).split('?')[0]);
  if (err.gitlabMessage) detailParts.push(`GitLab says: "${err.gitlabMessage}"`);
  return {
    ts: now,
    level: 'error',
    source: 'api',
    message: `GET ${normalizeApiPath(err.path || '?')} → ${statusText}`,
    detail: detailParts.join(' · '),
    hint: hintForStatus(status),
    count: 1,
  };
}

export const LOG_LIMITS = { error: 100, info: 200 };

export function pushLog(list, entry, limits = LOG_LIMITS) {
  list.unshift(entry);
  const counts = {};
  for (let i = 0; i < list.length; i++) {
    const level = list[i].level;
    counts[level] = (counts[level] || 0) + 1;
    const cap = limits[level] ?? 100;
    if (counts[level] > cap) {
      list.splice(i, 1);
      i--;
      counts[level] = cap;
    }
  }
  return list;
}
