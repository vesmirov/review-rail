export const mrKey = (projectId, iid) => `${projectId}:${iid}`;

export function hasAsapLabel(labels, asapLabel = 'asap') {
  const wanted = String(asapLabel || 'asap').toLowerCase();
  return (labels || []).some((l) => String(l).toLowerCase() === wanted);
}

export function pipelineIndicator(status) {
  if (status === 'success') return 'passed';
  if (status === 'failed') return 'failed';
  if (['created', 'waiting_for_resource', 'preparing', 'pending', 'running'].includes(status)) {
    return 'running';
  }
  return null;
}

export function mergeReviewerAndApprover(reviewerMrs, approverMrs, userId) {
  const seen = new Set((reviewerMrs || []).map((mr) => mrKey(mr.project_id, mr.iid)));
  const extras = [];
  for (const mr of approverMrs || []) {
    const key = mrKey(mr.project_id, mr.iid);
    if (seen.has(key)) continue;
    if (mr.author && mr.author.id === userId) continue;
    seen.add(key);
    extras.push(mr);
  }
  return extras;
}

export function queueItemFromMr(mr, { projectPath, asapLabel, source, now = Date.now(), requestedAt, viaGroup }) {
  const createdAt = mr.created_at ? Date.parse(mr.created_at) : NaN;
  return {
    ...(viaGroup ? { viaGroup: true } : {}),
    key: mrKey(mr.project_id, mr.iid),
    projectId: mr.project_id,
    iid: mr.iid,
    title: mr.title,
    author: (mr.author && mr.author.name) || '',
    projectPath,
    webUrl: mr.web_url,
    addedAt: now,
    requestedAt: requestedAt || now,
    createdAt: Number.isNaN(createdAt) ? now : createdAt,
    labels: mr.labels || [],
    source,
    asap: hasAsapLabel(mr.labels, asapLabel),
  };
}

export function refreshItemFromMr(item, mr, asapLabel) {
  item.title = mr.title;
  item.labels = mr.labels || [];
  item.asap = hasAsapLabel(mr.labels, asapLabel);
  const createdAt = mr.created_at ? Date.parse(mr.created_at) : NaN;
  if (!Number.isNaN(createdAt)) item.createdAt = createdAt;
  return item;
}

export function labelTextColor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance > 150 ? '#1f2124' : '#ffffff';
}

export function resolveRequestedAt({ isReReview, reviewerSince, now = Date.now() }) {
  if (isReReview) return now;
  return reviewerSince || now;
}

export function sortLabels(labels, asapLabel = 'asap') {
  const wanted = String(asapLabel || 'asap').toLowerCase();
  const list = labels || [];
  const pinned = list.filter((l) => String(l).toLowerCase() === wanted);
  const rest = list.filter((l) => String(l).toLowerCase() !== wanted);
  return [...pinned, ...rest];
}

export function hideItem(state, key, now = Date.now()) {
  const { queue, hidden, waiting = [] } = state;

  const fromQueue = queue.find((i) => i.key === key);
  if (fromQueue) {
    return {
      queue: queue.filter((i) => i.key !== key),
      hidden: [...hidden, { ...fromQueue, hiddenAt: now, hiddenState: 'unreviewed' }],
      waiting,
    };
  }

  const fromWaiting = waiting.find((i) => i.key === key);
  if (fromWaiting) {
    return {
      queue,
      hidden: [...hidden, { ...fromWaiting, hiddenAt: now, hiddenState: fromWaiting.state }],
      waiting: waiting.filter((i) => i.key !== key),
    };
  }

  return { queue, hidden, waiting };
}

export function restoreItem(state, key, now = Date.now()) {
  const { queue, hidden, waiting = [] } = state;
  const item = hidden.find((i) => i.key === key);
  if (!item) return { queue, hidden, waiting };

  const { hiddenAt, hiddenState, ...rest } = item;
  const nextHidden = hidden.filter((i) => i.key !== key);

  if (waitingState(hiddenState)) {
    return { queue, hidden: nextHidden, waiting: [...waiting, { ...rest, state: hiddenState }] };
  }
  return { queue: [...queue, { ...rest, addedAt: now }], hidden: nextHidden, waiting };
}

export function shouldUnhide(currentState, hiddenState) {
  if (!currentState) return false;
  if (!hiddenState) return currentState !== 'unreviewed';
  return currentState !== hiddenState;
}

export function applyQueueActions(state, actions) {
  let { queue, hidden, waiting = [] } = state;
  for (const action of actions) {
    if (action.type === 'hide') {
      ({ queue, hidden, waiting } = hideItem({ queue, hidden, waiting }, action.key, action.ts));
    } else if (action.type === 'restore') {
      ({ queue, hidden, waiting } = restoreItem({ queue, hidden, waiting }, action.key, action.ts));
    } else if (action.type === 'reorder') {
      queue = reorderWithin(queue, action.orderedKeys);
    }
  }
  return { queue, hidden, waiting };
}

export function reorderWithin(queue, keys) {
  const byKey = new Map(queue.map((i) => [i.key, i]));
  const orderedKeys = keys.filter((k) => byKey.has(k));
  const moved = new Set(orderedKeys);
  let idx = 0;
  return queue.map((i) => (moved.has(i.key) ? byKey.get(orderedKeys[idx++]) : i));
}

export function partitionQueue(queue) {
  const asap = queue.filter((i) => i.asap);
  const normal = queue.filter((i) => !i.asap);
  const next = asap[0] || normal[0] || null;
  return { asap, normal, nextKey: next ? next.key : null };
}

export function decideCompletion({ state, approvedByMe, commented }) {
  if (approvedByMe) return 'approved';
  if (state !== 'opened') return commented ? 'commented' : 'drop';
  return 'keep';
}

export function reviewerVerdict(reviewerState) {
  if (reviewerState === 'requested_changes') return 'changes_requested';
  if (reviewerState === 'reviewed') return 'commented';
  return null;
}

export function waitingState(reviewerState) {
  if (reviewerState === 'requested_changes' || reviewerState === 'reviewed') return reviewerState;
  return null;
}

export function shouldAutoAdd({ inQueue, inHistory, reviewerState, isSnoozed = false }) {
  if (inQueue) return false;
  if (waitingState(reviewerState) || reviewerState === 'approved') return false;
  if (isSnoozed) return false;
  if (!inHistory) return true;
  return reviewerState === 'unreviewed';
}
