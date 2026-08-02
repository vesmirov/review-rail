export function localDayStart(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function approvalEventToEntry(event, projectPaths, baseUrl) {
  if (!event || event.target_type !== 'MergeRequest') return null;
  const projectPath = projectPaths.get(event.project_id) || '';
  const iid = event.target_iid;
  const completedAt = Date.parse(event.created_at);
  if (!iid || Number.isNaN(completedAt)) return null;
  return {
    key: `${event.project_id}:${iid}`,
    title: event.target_title || `MR !${iid}`,
    projectPath,
    iid,
    webUrl: projectPath ? `${baseUrl}/${projectPath}/-/merge_requests/${iid}` : '',
    completedAt,
    how: 'approved',
  };
}

export function mergeHistory(existing, incoming, limit = 5000) {
  const dayKey = (e) => `${e.key}@${localDayStart(e.completedAt)}`;
  const seen = new Set(existing.map(dayKey));
  const merged = existing.slice();
  for (const e of incoming) {
    if (!e) continue;
    const k = dayKey(e);
    if (seen.has(k)) continue;
    seen.add(k);
    merged.push(e);
  }
  merged.sort((a, b) => b.completedAt - a.completedAt);
  return merged.slice(0, limit);
}

export function reconcileApprovals(history, eventEntries, limit = 5000) {
  const entries = eventEntries.filter(Boolean);
  if (!entries.length) return mergeHistory(history, [], limit);
  const eventKeys = new Set(entries.map((e) => e.key));
  const windowStart = Math.min(...entries.map((e) => e.completedAt));
  const kept = history.filter(
    (h) => !(h.how === 'approved' && eventKeys.has(h.key) && h.completedAt >= windowStart)
  );
  return mergeHistory(kept, entries, limit);
}
