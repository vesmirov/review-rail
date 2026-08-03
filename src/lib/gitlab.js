export const REQUEST_TIMEOUT_MS = 30_000;

export async function api(settings, path) {
  let res;
  try {
    res = await fetch(`${settings.baseUrl}/api/v4${path}`, {
      headers: { 'PRIVATE-TOKEN': settings.token },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    const timedOut = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    const err = new Error(
      timedOut
        ? `GitLab request timed out after ${REQUEST_TIMEOUT_MS / 1000} s: ${path}`
        : `GitLab is unreachable: ${(e && e.message) || 'network error'}`
    );
    err.status = 0;
    err.path = path;
    err.timedOut = Boolean(timedOut);
    throw err;
  }
  if (!res.ok) {
    let gitlabMessage = '';
    try {
      const body = await res.json();
      gitlabMessage = String(body.message || body.error || '');
    } catch {}
    const err = new Error(`GitLab API ${res.status}: ${path}`);
    err.status = res.status;
    err.path = path;
    err.gitlabMessage = gitlabMessage;
    throw err;
  }
  try {
    return await res.json();
  } catch {
    const err = new Error(
      `GitLab returned a non-JSON response for ${path} — an SSO or proxy page may have intercepted the request`
    );
    err.status = res.status;
    err.path = path;
    err.nonJson = true;
    throw err;
  }
}

export async function apiAll(settings, path, maxPages = 5) {
  const out = [];
  for (let page = 1; page <= maxPages; page++) {
    const sep = path.includes('?') ? '&' : '?';
    const batch = await api(settings, `${path}${sep}page=${page}`);
    if (!Array.isArray(batch)) return batch;
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

export function projectPathFromUrl(webUrl) {
  try {
    const u = new URL(webUrl);
    return u.pathname.replace(/\/-\/merge_requests\/.*$/, '').replace(/^\//, '');
  } catch {
    return '';
  }
}

export function connectErrorMessage(err, baseUrl) {
  const status = err && err.status;
  if (status === 401) return 'GitLab rejected the token — check that you pasted it correctly';
  if (status === 403) return 'The token was accepted but lacks access — make sure it has the read_api scope';
  if (status === 404) return `${baseUrl} doesn't look like a GitLab instance — check the URL`;
  if (status === 0) return `Can't reach ${baseUrl} — check the address and your VPN`;
  if (status >= 500) return `GitLab returned a server error (${status}) — try again in a minute`;
  return String((err && err.message) || err);
}

export function normalizeBaseUrl(raw) {
  const clean = String(raw || '').trim().replace(/\/+$/, '');
  if (!/^https:\/\//i.test(clean)) return null;
  try {
    const u = new URL(clean);
    const path = u.pathname.replace(/\/+$/, '');
    return u.origin + (path === '' || path === '/' ? '' : path);
  } catch {
    return null;
  }
}
