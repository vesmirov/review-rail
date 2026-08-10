import { projectPathFromUrl } from '../lib/gitlab.js';
import {
  mrKey,
  queueItemFromMr,
  refreshItemFromMr,
  decideCompletion,
  reviewerVerdict,
  shouldAutoAdd,
  waitingState,
  resolveRequestedAt,
  shouldUnhide,
  applyQueueActions,
  mergeReviewerAndApprover,
  pipelineIndicator,
} from '../lib/queue.js';
import { approvalEventToEntry, reconcileApprovals } from '../lib/history.js';
import { getState, updateBadge, logInfo, logError, enqueueWrite, HISTORY_LIMIT } from './store.js';
import { tapi, tapiAll } from './api.js';

async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

const POOL_LIMIT = 5;

const LABEL_COLORS_TTL = 864e5;

const REVOKED_TTL = 180 * 864e5;

let syncRunning = false;
let pendingActions = [];

export function isSyncRunning() {
  return syncRunning;
}

export function recordPendingAction(action) {
  if (syncRunning) pendingActions.push(action);
}

export async function myReviewerInfo(settings, projectId, iid) {
  try {
    const reviewers = await tapi(settings, `/projects/${projectId}/merge_requests/${iid}/reviewers`);
    const me = reviewers.find((r) => r.user && r.user.id === settings.userId);
    if (!me) return { ok: true, found: false, state: null, since: null };
    const since = me.created_at ? Date.parse(me.created_at) : null;
    return {
      ok: true,
      found: true,
      state: me.state || null,
      since: Number.isNaN(since) ? null : since,
    };
  } catch {
    return { ok: false, found: false, state: null, since: null };
  }
}

async function fetchApprovalEvents(settings, maxPages) {
  const events = [];
  for (let page = 1; page <= maxPages; page++) {
    const batch = await tapi(
      settings,
      `/users/${settings.userId}/events?action=approved&per_page=100&page=${page}`
    );
    events.push(...batch.filter((e) => e.target_type === 'MergeRequest'));
    if (batch.length < 100) break;
  }
  return events;
}

async function resolveProjectPaths(settings, projectIds) {
  const { projectPaths = {} } = await chrome.storage.local.get('projectPaths');
  const missing = projectIds.filter((id) => !projectPaths[id]);
  await Promise.all(
    missing.map(async (id) => {
      try {
        const project = await tapi(settings, `/projects/${id}`);
        projectPaths[id] = project.path_with_namespace;
      } catch {}
    })
  );
  if (missing.length) await chrome.storage.local.set({ projectPaths });
  return new Map(Object.entries(projectPaths).map(([id, path]) => [Number(id), path]));
}

async function importApprovalHistory(settings, maxPages) {
  const events = await fetchApprovalEvents(settings, maxPages);
  const paths = await resolveProjectPaths(settings, [...new Set(events.map((e) => e.project_id))]);
  const { revokedApprovals = {} } = await chrome.storage.local.get('revokedApprovals');
  const entries = events
    .map((e) => approvalEventToEntry(e, paths, settings.baseUrl))
    .filter((e) => e && !(revokedApprovals[e.key] && e.completedAt <= revokedApprovals[e.key]));
  const { history } = await getState();
  await chrome.storage.local.set({
    history: reconcileApprovals(history, entries, HISTORY_LIMIT),
    backfillDoneAt: Date.now(),
  });
}

async function syncLabelColors(settings, queue) {
  const { labelColors = {}, labelColorsAt = {} } = await chrome.storage.local.get([
    'labelColors',
    'labelColorsAt',
  ]);
  const now = Date.now();
  const hasUnknownLabel = (pid) =>
    queue.some(
      (i) => i.projectId === pid && (i.labels || []).some((l) => !(labelColors[pid] || {})[l])
    );
  const stale = [...new Set(queue.map((i) => i.projectId))].filter(
    (pid) =>
      !labelColors[pid] ||
      now - (labelColorsAt[pid] || 0) > LABEL_COLORS_TTL ||
      hasUnknownLabel(pid)
  );
  await Promise.all(
    stale.map(async (pid) => {
      try {
        const labels = await tapiAll(settings, `/projects/${pid}/labels?per_page=100`, 3);
        labelColors[pid] = Object.fromEntries(labels.map((l) => [l.name, l.color]));
        labelColorsAt[pid] = now;
      } catch {}
    })
  );
  if (stale.length) await chrome.storage.local.set({ labelColors, labelColorsAt });
}

function waitingEntry(source, reviewerState) {
  const fromMr = source.project_id !== undefined;
  const createdAtRaw = fromMr
    ? source.created_at
      ? Date.parse(source.created_at)
      : NaN
    : source.createdAt || NaN;
  return {
    key: fromMr ? mrKey(source.project_id, source.iid) : source.key,
    projectId: fromMr ? source.project_id : source.projectId,
    iid: source.iid,
    title: source.title,
    author: fromMr ? (source.author && source.author.name) || '' : source.author,
    projectPath: fromMr ? projectPathFromUrl(source.web_url) : source.projectPath,
    webUrl: fromMr ? source.web_url : source.webUrl,
    createdAt: Number.isNaN(createdAtRaw) ? undefined : createdAtRaw,
    labels: source.labels || [],
    state: reviewerState,
  };
}

function completeItem(history, item, how) {
  history.unshift({
    key: item.key,
    title: item.title,
    projectPath: item.projectPath,
    iid: item.iid,
    webUrl: item.webUrl,
    completedAt: Date.now(),
    how,
  });
}

export async function sync() {
  if (syncRunning) return { ok: true, skipped: true };
  syncRunning = true;
  pendingActions = [];
  const startedAt = Date.now();
  let step = 'read state';
  await chrome.storage.local.set({ syncing: true, syncStartedAt: startedAt });
  try {
    const state = await getState();
    const settings = state.settings;
    if (!settings || !settings.token) return { ok: false, error: 'Not connected to GitLab' };

    let queue = state.queue.slice();
    const history = state.history.slice();
    const waiting = [];
    let hidden = state.hidden.slice();
    const legacySnoozed = { ...state.snoozed };
    const hiddenKeys = new Set(hidden.map((i) => i.key));
    const hiddenByKey = new Map(hidden.map((i) => [i.key, i]));
    const queueKeys = new Set(queue.map((i) => i.key));
    const historyKeys = new Set(history.map((i) => i.key));

    step = 'fetch assigned MRs';
    const assigned = await tapiAll(
      settings,
      `/merge_requests?scope=all&state=opened&reviewer_username=${encodeURIComponent(settings.username)}&per_page=100`
    );

    step = 'fetch group-approval MRs';
    let groupExtras = [];
    let approverListOk = true;
    if (settings.userId) {
      const approverMrs = await tapiAll(
        settings,
        `/merge_requests?scope=all&state=opened&approver_ids[]=${settings.userId}&per_page=100`
      ).catch(() => {
        approverListOk = false;
        return [];
      });
      groupExtras = mergeReviewerAndApprover(
        assigned,
        Array.isArray(approverMrs) ? approverMrs : [],
        settings.userId
      );
      if (groupExtras.length) {
        const approvedChecks = await pool(groupExtras, POOL_LIMIT, (mr) =>
          tapi(settings, `/projects/${mr.project_id}/merge_requests/${mr.iid}/approvals`)
            .then((a) =>
              ((a && a.approved_by) || []).some((x) => x.user && x.user.id === settings.userId)
            )
            .catch(() => null)
        );
        // null = check failed; skip the MR this cycle rather than guess either way.
        groupExtras = groupExtras.filter((_, i) => approvedChecks[i] === false);
      }
    }
    const groupKeys = new Set(groupExtras.map((mr) => mrKey(mr.project_id, mr.iid)));

    const allIncoming = [...assigned, ...groupExtras];
    const assignedByKey = new Map(allIncoming.map((mr) => [mrKey(mr.project_id, mr.iid), mr]));
    const assignedKeys = new Set(assignedByKey.keys());

    step = 'check reviewer states';
    const newAssigned = assigned.filter((mr) => !queueKeys.has(mrKey(mr.project_id, mr.iid)));
    const infoByKey = new Map(
      await pool(newAssigned, POOL_LIMIT, async (mr) => [
        mrKey(mr.project_id, mr.iid),
        await myReviewerInfo(settings, mr.project_id, mr.iid),
      ])
    );

    let added = 0;
    const revokedKeys = [];
    for (const mr of allIncoming) {
      const key = mrKey(mr.project_id, mr.iid);
      const inQueue = queueKeys.has(key);
      const inHistory = historyKeys.has(key);
      const info = infoByKey.get(key) || { state: null, since: null };
      const reviewerState = inQueue ? null : info.state;

      const hiddenRec = hiddenByKey.get(key);
      if (hiddenRec && shouldUnhide(reviewerState, hiddenRec.hiddenState)) {
        hidden = hidden.filter((i) => i.key !== key);
        hiddenKeys.delete(key);
        hiddenByKey.delete(key);
      }
      if (legacySnoozed[key] && !hiddenKeys.has(key) && !inQueue && !shouldUnhide(reviewerState)) {
        hidden.push({
          ...queueItemFromMr(mr, {
            projectPath: projectPathFromUrl(mr.web_url),
            asapLabel: settings.asapLabel,
            source: 'auto',
            requestedAt: info.since || undefined,
          }),
          hiddenAt: legacySnoozed[key],
        });
        hiddenKeys.add(key);
      }
      if (
        shouldAutoAdd({
          inQueue,
          inHistory,
          reviewerState,
          isSnoozed: hiddenKeys.has(key),
          viaGroup: groupKeys.has(key),
        })
      ) {
        if (inHistory && reviewerState !== 'unreviewed') {
          revokedKeys.push(key);
          for (let i = history.length - 1; i >= 0; i--) {
            if (history[i].key === key && history[i].how === 'approved') history.splice(i, 1);
          }
        }
        const queueItem = queueItemFromMr(mr, {
          projectPath: projectPathFromUrl(mr.web_url),
          asapLabel: settings.asapLabel,
          viaGroup: groupKeys.has(key),
          source: 'auto',
          requestedAt: resolveRequestedAt({ isReReview: inHistory, reviewerSince: info.since }),
        });
        queueItem.updatedAt = mr.updated_at;
        queue.push(queueItem);
        queueKeys.add(key);
        added++;
      } else if (!inQueue && !hiddenKeys.has(key) && waitingState(reviewerState)) {
        waiting.push(waitingEntry(mr, reviewerState));
      }
    }
    if (revokedKeys.length) {
      // Remembered so the events backfill doesn't resurrect withdrawn approvals:
      // GitLab keeps the "approved" event after a revoke.
      const { revokedApprovals = {} } = await chrome.storage.local.get('revokedApprovals');
      const now = Date.now();
      for (const k of revokedKeys) revokedApprovals[k] = now;
      for (const [k, ts] of Object.entries(revokedApprovals)) {
        if (now - ts > REVOKED_TTL) delete revokedApprovals[k];
      }
      await chrome.storage.local.set({ revokedApprovals });
    }

    step = 'check queue items';
    // 'none' = poll succeeded, nothing to show; null/undefined = unknown, re-poll.
    const refreshPipeline = async (item, mr) => {
      try {
        if (mr && 'head_pipeline' in mr) {
          item.pipeline = pipelineIndicator(mr.head_pipeline && mr.head_pipeline.status) || 'none';
        } else {
          const pipes = await tapi(
            settings,
            `/projects/${item.projectId}/merge_requests/${item.iid}/pipelines?per_page=1`
          );
          item.pipeline = pipelineIndicator(pipes && pipes[0] && pipes[0].status) || 'none';
        }
      } catch {
        // a failed poll keeps the last known status
      }
    };

    const fetchApprovedByMe = (item) =>
      tapi(settings, `/projects/${item.projectId}/merge_requests/${item.iid}/approvals`)
        .then((a) =>
          ((a && a.approved_by) || []).some((x) => x.user && x.user.id === settings.userId)
        )
        .catch(() => false);

    const outcomes = await pool(queue, POOL_LIMIT, async (item) => {
      try {
        const fromList = assignedByKey.get(item.key);
        const mr =
          fromList || (await tapi(settings, `/projects/${item.projectId}/merge_requests/${item.iid}`));
        refreshItemFromMr(item, mr, settings.asapLabel);

        // Reviewer verdicts don't bump updated_at (verified against gitlab.com).
        const unchanged = fromList && item.updatedAt && fromList.updated_at === item.updatedAt;
        if (unchanged) {
          if (item.pipeline === 'running' || item.pipeline == null) await refreshPipeline(item, null);
          const rState = (await myReviewerInfo(settings, item.projectId, item.iid)).state;
          const verdict = reviewerVerdict(rState);
          if (verdict) return { type: 'review-sent', item, how: verdict, rState };
          if (rState === 'approved' && (await fetchApprovedByMe(item))) {
            return { type: 'approved', item };
          }
          return { type: 'keep', item };
        }

        await refreshPipeline(item, mr);

        const approvedByMe = await fetchApprovedByMe(item);

        if (!approvedByMe && mr.state === 'opened') {
          const rInfo = await myReviewerInfo(settings, item.projectId, item.iid);
          // Drop only on a confirmed absence — a failed /reviewers call must not evict cards.
          if (!fromList && !item.viaGroup && rInfo.ok && !rInfo.found) {
            return { type: 'unassigned', item };
          }
          const verdict = reviewerVerdict(rInfo.state);
          if (verdict) return { type: 'review-sent', item, how: verdict, rState: rInfo.state };
        }

        let commented = false;
        if (!approvedByMe && mr.state !== 'opened') {
          commented = await tapiAll(
            settings,
            `/projects/${item.projectId}/merge_requests/${item.iid}/notes?per_page=100&order_by=updated_at&sort=desc`,
            3
          )
            .then((notes) => notes.some((n) => !n.system && n.author && n.author.id === settings.userId))
            .catch(() => false);
        }

        const outcome = { type: decideCompletion({ state: mr.state, approvedByMe, commented }), item };
        if (outcome.type === 'keep') item.updatedAt = mr.updated_at;
        return outcome;
      } catch (e) {
        if (e && e.status === 404) return { type: 'gone', item };
        return { type: 'keep', item };
      }
    });

    let completed = 0;
    let removed = 0;
    let unassigned = 0;
    const remaining = [];
    for (const outcome of outcomes) {
      if (outcome.type === 'review-sent') {
        completeItem(history, outcome.item, outcome.how);
        waiting.push(waitingEntry(outcome.item, outcome.rState));
        completed++;
      } else if (outcome.type === 'approved' || outcome.type === 'commented') {
        completeItem(history, outcome.item, outcome.type);
        completed++;
      } else if (outcome.type === 'gone') {
        removed++;
      } else if (outcome.type === 'unassigned') {
        unassigned++;
      } else if (outcome.type === 'keep') {
        remaining.push(outcome.item);
      }
    }
    queue = remaining;

    const hiddenCleanupSafe = !settings.userId || approverListOk;
    if (hiddenCleanupSafe) {
      hidden = hidden.filter((i) => assignedKeys.has(i.key));
    }

    step = 'fetch label colors';
    await syncLabelColors(settings, queue);

    step = 'save results';
    let reconciled;
    await enqueueWrite(async () => {
      reconciled = applyQueueActions({ queue, hidden, waiting }, pendingActions);
      await chrome.storage.local.set({
        queue: reconciled.queue,
        history: history.slice(0, HISTORY_LIMIT),
        waiting: reconciled.waiting,
        hidden: reconciled.hidden,
        snoozed: {},
        lastSync: Date.now(),
        lastError: null,
      });
    });

    step = 'import approval history';
    try {
      await importApprovalHistory(settings, state.backfillDoneAt ? 1 : 20);
    } catch {}

    await updateBadge();

    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    const parts = [
      `queue: ${reconciled.queue.length}`,
      `awaiting author: ${reconciled.waiting.length}`,
    ];
    if (added) parts.push(`${added} added`);
    if (completed) parts.push(`${completed} completed`);
    if (removed) parts.push(`${removed} gone (404)`);
    if (unassigned) parts.push(`${unassigned} unassigned`);
    if (!added && !completed && !removed && !unassigned) parts.push('no changes');
    logInfo('sync', `Synced in ${seconds} s · ${parts.join(' · ')}`);

    return { ok: true };
  } catch (e) {
    const message = String((e && e.message) || e);
    logError('sync', `Sync stopped at step "${step}"`, message);
    await chrome.storage.local.set({ lastError: message });
    return { ok: false, error: message };
  } finally {
    syncRunning = false;
    pendingActions = [];
    await chrome.storage.local.set({ syncing: false });
  }
}
