import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mrKey,
  hasAsapLabel,
  queueItemFromMr,
  reorderWithin,
  partitionQueue,
  decideCompletion,
  reviewerVerdict,
  shouldAutoAdd,
  waitingState,
  resolveRequestedAt,
  hideItem,
  restoreItem,
  shouldUnhide,
  sortLabels,
  labelTextColor,
  refreshItemFromMr,
  pipelineIndicator,
  mergeReviewerAndApprover,
  applyQueueActions,
  shortName,
  shortPath,
} from '../src/lib/queue.js';

const item = (key, asap = false) => ({ key, asap });

test('mrKey joins project id and iid', () => {
  assert.equal(mrKey(42, 7), '42:7');
});

test('hasAsapLabel: case-insensitive, default label is asap', () => {
  assert.equal(hasAsapLabel(['bug', 'ASAP']), true);
  assert.equal(hasAsapLabel(['bug']), false);
  assert.equal(hasAsapLabel([]), false);
  assert.equal(hasAsapLabel(undefined), false);
});

test('hasAsapLabel: configurable label name', () => {
  assert.equal(hasAsapLabel(['priority::urgent'], 'priority::urgent'), true);
  assert.equal(hasAsapLabel(['asap'], 'priority::urgent'), false);
});

test('queueItemFromMr copies MR fields, opened date, labels and the asap flag', () => {
  const mr = {
    project_id: 5,
    iid: 12,
    title: 'Fix things',
    author: { name: 'Anya' },
    web_url: 'https://git.corp/team/app/-/merge_requests/12',
    labels: ['ASAP', 'backend'],
    created_at: '2026-07-01T10:00:00.000Z',
  };
  const it = queueItemFromMr(mr, { projectPath: 'team/app', asapLabel: 'asap', source: 'manual', now: 1000, requestedAt: 500 });
  assert.deepEqual(it, {
    key: '5:12',
    projectId: 5,
    iid: 12,
    title: 'Fix things',
    author: 'Anya',
    projectPath: 'team/app',
    webUrl: 'https://git.corp/team/app/-/merge_requests/12',
    addedAt: 1000,
    requestedAt: 500,
    createdAt: Date.parse('2026-07-01T10:00:00.000Z'),
    labels: ['ASAP', 'backend'],
    source: 'manual',
    asap: true,
  });
});

test('queueItemFromMr: falls back to now when created_at is missing', () => {
  const mr = { project_id: 1, iid: 2, title: 't', author: null, web_url: 'x', labels: [] };
  const it = queueItemFromMr(mr, { projectPath: 'p', asapLabel: 'asap', source: 'auto', now: 42 });
  assert.equal(it.createdAt, 42);
});

test('refreshItemFromMr: backfills the opened date on legacy cards without createdAt', () => {
  const item = { key: '5:12', title: 'old', labels: [], asap: false };
  refreshItemFromMr(item, {
    title: 'new title',
    labels: ['ASAP', 'backend'],
    created_at: '2026-07-20T08:00:00.000Z',
  }, 'asap');
  assert.equal(item.title, 'new title');
  assert.equal(item.createdAt, Date.parse('2026-07-20T08:00:00.000Z'));
  assert.deepEqual(item.labels, ['ASAP', 'backend']);
  assert.equal(item.asap, true);
});

test('refreshItemFromMr: keeps the date when the response has no created_at', () => {
  const item = { key: '5:12', title: 'old', labels: [], asap: false, createdAt: 123 };
  refreshItemFromMr(item, { title: 't', labels: [] }, 'asap');
  assert.equal(item.createdAt, 123);
});

test('labelTextColor: dark text on light backgrounds, light text on dark ones', () => {
  assert.equal(labelTextColor('#ffffff'), '#1f2124');
  assert.equal(labelTextColor('#f5d90a'), '#1f2124');
  assert.equal(labelTextColor('#dc3545'), '#ffffff');
  assert.equal(labelTextColor('#1f2124'), '#ffffff');
  assert.equal(labelTextColor('garbage'), '#ffffff');
});

test('drag with no urgent items: any card can become first in the list', () => {
  const q = [
    { key: 'a', asap: false },
    { key: 'b', asap: false },
    { key: 'c', asap: false },
  ];
  const reordered = reorderWithin(q, ['c', 'a', 'b']);
  const { normal, nextKey } = partitionQueue(reordered);
  assert.equal(nextKey, 'c');
  assert.deepEqual(normal.map((i) => i.key), ['c', 'a', 'b']);
});

test('drag with urgent items: asap cards swap priority among themselves, normal ones do not move', () => {
  const q = [
    { key: 'n1', asap: false },
    { key: 'a1', asap: true },
    { key: 'n2', asap: false },
    { key: 'a2', asap: true },
  ];
  const reordered = reorderWithin(q, ['a2', 'a1']);
  const { asap, normal, nextKey } = partitionQueue(reordered);
  assert.equal(nextKey, 'a2');
  assert.deepEqual(asap.map((i) => i.key), ['a2', 'a1']);
  assert.deepEqual(normal.map((i) => i.key), ['n1', 'n2']);
  assert.deepEqual(reordered.map((i) => i.key), ['n1', 'a2', 'n2', 'a1']);
});

test('drag of normal cards below urgent ones: an asap card stays first', () => {
  const q = [
    { key: 'a1', asap: true },
    { key: 'n1', asap: false },
    { key: 'n2', asap: false },
  ];
  const reordered = reorderWithin(q, ['n2', 'n1']);
  const { normal, nextKey } = partitionQueue(reordered);
  assert.equal(nextKey, 'a1');
  assert.deepEqual(normal.map((i) => i.key), ['n2', 'n1']);
});

test('resolveRequestedAt: first review uses the reviewer assignment date, re-review uses the moment it came back', () => {
  assert.equal(resolveRequestedAt({ isReReview: false, reviewerSince: 500, now: 1000 }), 500);
  assert.equal(resolveRequestedAt({ isReReview: true, reviewerSince: 500, now: 1000 }), 1000);
  assert.equal(resolveRequestedAt({ isReReview: false, reviewerSince: null, now: 1000 }), 1000);
});

test('reorderWithin: moves only the listed items, other positions stay untouched', () => {
  const q = [item('a'), item('b'), item('c'), item('d')];
  const next = reorderWithin(q, ['c', 'b']);
  assert.deepEqual(next.map((i) => i.key), ['a', 'c', 'b', 'd']);
});

test('reorderWithin: ignores stale keys', () => {
  const q = [item('a'), item('b')];
  const next = reorderWithin(q, ['b', 'gone', 'a']);
  assert.deepEqual(next.map((i) => i.key), ['b', 'a']);
});

test('reorderWithin: an empty key list changes nothing', () => {
  const q = [item('a'), item('b')];
  assert.deepEqual(reorderWithin(q, []).map((i) => i.key), ['a', 'b']);
});

test('partitionQueue: asap block goes first, the next item is the first asap', () => {
  const q = [item('a'), item('b', true), item('c'), item('d', true)];
  const { asap, normal, nextKey } = partitionQueue(q);
  assert.deepEqual(asap.map((i) => i.key), ['b', 'd']);
  assert.deepEqual(normal.map((i) => i.key), ['a', 'c']);
  assert.equal(nextKey, 'b');
});

test('partitionQueue: with no asap the next item is the FIFO head', () => {
  const { nextKey } = partitionQueue([item('a'), item('b')]);
  assert.equal(nextKey, 'a');
});

test('partitionQueue: empty queue', () => {
  assert.deepEqual(partitionQueue([]), { asap: [], normal: [], nextKey: null });
});

test('decideCompletion: an approval always counts', () => {
  assert.equal(decideCompletion({ state: 'opened', approvedByMe: true, commented: false }), 'approved');
  assert.equal(decideCompletion({ state: 'merged', approvedByMe: true, commented: true }), 'approved');
});

test('decideCompletion: merged/closed with comments counts, without comments is dropped', () => {
  assert.equal(decideCompletion({ state: 'merged', approvedByMe: false, commented: true }), 'commented');
  assert.equal(decideCompletion({ state: 'closed', approvedByMe: false, commented: false }), 'drop');
});

test('decideCompletion: an open MR without approval stays in the queue', () => {
  assert.equal(decideCompletion({ state: 'opened', approvedByMe: false, commented: true }), 'keep');
});

test('reviewerVerdict: request changes and submitted review count', () => {
  assert.equal(reviewerVerdict('requested_changes'), 'changes_requested');
  assert.equal(reviewerVerdict('reviewed'), 'commented');
});

test('reviewerVerdict: unreviewed, approved and unknown statuses do not count', () => {
  assert.equal(reviewerVerdict('unreviewed'), null);
  assert.equal(reviewerVerdict('approved'), null);
  assert.equal(reviewerVerdict(null), null);
  assert.equal(reviewerVerdict('review_started'), null);
});

test('shouldAutoAdd: a new MR is added, one already in the queue is not', () => {
  assert.equal(shouldAutoAdd({ inQueue: false, inHistory: false, reviewerState: null }), true);
  assert.equal(shouldAutoAdd({ inQueue: true, inHistory: false, reviewerState: null }), false);
});

test('shouldAutoAdd: after a counted review the MR comes back only when review is requested again', () => {
  assert.equal(shouldAutoAdd({ inQueue: false, inHistory: true, reviewerState: 'unreviewed' }), true);
  assert.equal(shouldAutoAdd({ inQueue: false, inHistory: true, reviewerState: 'requested_changes' }), false);
  assert.equal(shouldAutoAdd({ inQueue: false, inHistory: true, reviewerState: 'approved' }), false);
  assert.equal(shouldAutoAdd({ inQueue: false, inHistory: true, reviewerState: null }), false);
});


test('shouldAutoAdd: a revoked approval puts the MR back in the queue', () => {
  assert.equal(shouldAutoAdd({ inQueue: false, inHistory: true, reviewerState: 'unapproved' }), true);
  // a group MR (no reviewer record) appears in the approver list again without an approval
  assert.equal(
    shouldAutoAdd({ inQueue: false, inHistory: true, reviewerState: null, viaGroup: true }),
    true
  );
  // a regular MR with a null state still does not come back
  assert.equal(shouldAutoAdd({ inQueue: false, inHistory: true, reviewerState: null }), false);
});

test('shouldAutoAdd: an MR with an already submitted review does not enter the queue even without history', () => {
  assert.equal(shouldAutoAdd({ inQueue: false, inHistory: false, reviewerState: 'requested_changes' }), false);
  assert.equal(shouldAutoAdd({ inQueue: false, inHistory: false, reviewerState: 'reviewed' }), false);
  assert.equal(shouldAutoAdd({ inQueue: false, inHistory: false, reviewerState: 'approved' }), false);
  assert.equal(shouldAutoAdd({ inQueue: false, inHistory: false, reviewerState: 'unreviewed' }), true);
});

test('shouldAutoAdd: a manually removed (snoozed) MR does not come back while it sits in GitLab unreviewed', () => {
  assert.equal(shouldAutoAdd({ inQueue: false, inHistory: false, reviewerState: 'unreviewed', isSnoozed: true }), false);
  assert.equal(shouldAutoAdd({ inQueue: false, inHistory: true, reviewerState: 'unreviewed', isSnoozed: true }), false);
  assert.equal(shouldAutoAdd({ inQueue: false, inHistory: false, reviewerState: null, isSnoozed: true }), false);
  assert.equal(shouldAutoAdd({ inQueue: false, inHistory: false, reviewerState: 'unreviewed', isSnoozed: false }), true);
});

test('hideItem: moves an MR from the queue to hidden with a timestamp and its state', () => {
  const state = { queue: [{ key: 'a', title: 'A' }, { key: 'b', title: 'B' }], hidden: [], waiting: [] };
  const { queue, hidden } = hideItem(state, 'a', 777);
  assert.deepEqual(queue.map((i) => i.key), ['b']);
  assert.equal(hidden.length, 1);
  assert.equal(hidden[0].key, 'a');
  assert.equal(hidden[0].hiddenAt, 777);
  assert.equal(hidden[0].hiddenState, 'unreviewed');
});

test('hideItem: hides a card from the waiting section, remembering its state', () => {
  const state = {
    queue: [],
    hidden: [],
    waiting: [{ key: 'w', title: 'W', state: 'requested_changes' }],
  };
  const { hidden, waiting } = hideItem(state, 'w', 500);
  assert.deepEqual(waiting, []);
  assert.equal(hidden[0].hiddenState, 'requested_changes');
  assert.equal(hidden[0].hiddenAt, 500);
});

test('hideItem: unknown key changes nothing', () => {
  const state = { queue: [{ key: 'a' }], hidden: [], waiting: [] };
  const { queue, hidden, waiting } = hideItem(state, 'nope', 1);
  assert.deepEqual(queue, state.queue);
  assert.deepEqual(hidden, []);
  assert.deepEqual(waiting, []);
});

test('restoreItem: an item hidden from the queue returns to the queue', () => {
  const state = {
    queue: [{ key: 'b' }],
    hidden: [{ key: 'a', title: 'A', requestedAt: 100, addedAt: 100, hiddenAt: 200, hiddenState: 'unreviewed' }],
    waiting: [],
  };
  const { queue, hidden, waiting } = restoreItem(state, 'a', 999);
  assert.deepEqual(queue.map((i) => i.key), ['b', 'a']);
  assert.equal(queue[1].addedAt, 999);
  assert.equal(queue[1].requestedAt, 100);
  assert.equal(queue[1].hiddenAt, undefined);
  assert.equal(queue[1].hiddenState, undefined);
  assert.deepEqual(hidden, []);
  assert.deepEqual(waiting, []);
});

test('restoreItem: an item hidden from waiting returns to its own section, not the queue', () => {
  const state = {
    queue: [],
    hidden: [{ key: 'w', title: 'W', hiddenAt: 1, hiddenState: 'reviewed' }],
    waiting: [],
  };
  const { queue, hidden, waiting } = restoreItem(state, 'w', 999);
  assert.deepEqual(queue, []);
  assert.deepEqual(hidden, []);
  assert.equal(waiting.length, 1);
  assert.equal(waiting[0].state, 'reviewed');
  assert.equal(waiting[0].hiddenAt, undefined);
});

test('restoreItem: unknown key changes nothing', () => {
  const state = { queue: [], hidden: [{ key: 'a', hiddenAt: 1 }], waiting: [] };
  const { queue, hidden } = restoreItem(state, 'nope');
  assert.deepEqual(queue, []);
  assert.deepEqual(hidden, state.hidden);
});

test('applyQueueActions: user actions are replayed on top of the sync result', () => {
  const state = {
    queue: [
      { key: 'a', title: 'A' },
      { key: 'b', title: 'B' },
      { key: 'c', title: 'C' },
    ],
    hidden: [{ key: 'z', title: 'Z', hiddenAt: 1, hiddenState: 'unreviewed' }],
    waiting: [],
  };
  const result = applyQueueActions(state, [
    { type: 'hide', key: 'b', ts: 100 },
    { type: 'restore', key: 'z', ts: 200 },
    { type: 'reorder', orderedKeys: ['c', 'a'] },
  ]);
  assert.deepEqual(result.queue.map((i) => i.key), ['c', 'a', 'z']);
  assert.deepEqual(result.hidden.map((i) => i.key), ['b']);
  assert.equal(result.hidden[0].hiddenAt, 100);
});

test('applyQueueActions: hiding a waiting card is replayed on top of sync', () => {
  const state = {
    queue: [{ key: 'a' }],
    hidden: [],
    waiting: [{ key: 'w', state: 'reviewed' }],
  };
  const result = applyQueueActions(state, [{ type: 'hide', key: 'w', ts: 50 }]);
  assert.deepEqual(result.waiting, []);
  assert.deepEqual(result.hidden.map((i) => i.key), ['w']);
  assert.equal(result.hidden[0].hiddenState, 'reviewed');
});

test('applyQueueActions: actions on MRs that disappeared are ignored', () => {
  const state = { queue: [{ key: 'a' }], hidden: [], waiting: [] };
  const result = applyQueueActions(state, [
    { type: 'hide', key: 'gone', ts: 1 },
    { type: 'restore', key: 'also-gone', ts: 2 },
  ]);
  assert.deepEqual(result.queue.map((i) => i.key), ['a']);
  assert.deepEqual(result.hidden, []);
});

test('shouldUnhide: unhides when the state changed relative to the moment of hiding', () => {
  assert.equal(shouldUnhide('unreviewed', 'requested_changes'), true);
  assert.equal(shouldUnhide('approved', 'requested_changes'), true);
  assert.equal(shouldUnhide('requested_changes', 'requested_changes'), false);
  assert.equal(shouldUnhide('reviewed', 'reviewed'), false);
  assert.equal(shouldUnhide('requested_changes', 'unreviewed'), true);
  assert.equal(shouldUnhide('unreviewed', 'unreviewed'), false);
});

test('shouldUnhide: an unknown current state does not unhide', () => {
  assert.equal(shouldUnhide(null, 'requested_changes'), false);
  assert.equal(shouldUnhide(null, null), false);
});

test('shouldUnhide: legacy records without hiddenState are treated as hidden from the queue', () => {
  assert.equal(shouldUnhide('requested_changes', undefined), true);
  assert.equal(shouldUnhide('unreviewed', undefined), false);
});

test('sortLabels: the urgency label always comes first', () => {
  assert.deepEqual(sortLabels(['backend', 'config', 'asap'], 'asap'), ['asap', 'backend', 'config']);
  assert.deepEqual(sortLabels(['backend', 'ASAP'], 'asap'), ['ASAP', 'backend']);
  assert.deepEqual(sortLabels(['backend', 'priority::urgent'], 'priority::urgent'), [
    'priority::urgent',
    'backend',
  ]);
  assert.deepEqual(sortLabels(['backend', 'config'], 'asap'), ['backend', 'config']);
  assert.deepEqual(sortLabels([], 'asap'), []);
  assert.deepEqual(sortLabels(undefined, 'asap'), []);
});

test('waitingState: only requested_changes and reviewed land in the waiting block', () => {
  assert.equal(waitingState('requested_changes'), 'requested_changes');
  assert.equal(waitingState('reviewed'), 'reviewed');
  assert.equal(waitingState('approved'), null);
  assert.equal(waitingState('unreviewed'), null);
  assert.equal(waitingState(null), null);
});

test('pipelineIndicator: three states and no icon otherwise', () => {
  assert.equal(pipelineIndicator('success'), 'passed');
  assert.equal(pipelineIndicator('failed'), 'failed');
  for (const s of ['created', 'waiting_for_resource', 'preparing', 'pending', 'running']) {
    assert.equal(pipelineIndicator(s), 'running', s);
  }
  for (const s of ['canceled', 'skipped', 'manual', 'scheduled', null, undefined, '', 'garbage']) {
    assert.equal(pipelineIndicator(s), null, String(s));
  }
});

test('mergeReviewerAndApprover: dedupes by key, the reviewer list takes precedence', () => {
  const rev = [{ project_id: 1, iid: 10, author: { id: 2 } }];
  const app = [
    { project_id: 1, iid: 10, author: { id: 2 } },
    { project_id: 1, iid: 11, author: { id: 3 } },
  ];
  const extras = mergeReviewerAndApprover(rev, app, 658);
  assert.equal(extras.length, 1);
  assert.equal(extras[0].iid, 11);
});

test('mergeReviewerAndApprover: own MRs are excluded', () => {
  const app = [
    { project_id: 1, iid: 20, author: { id: 658 } },
    { project_id: 1, iid: 21, author: { id: 3 } },
    { project_id: 1, iid: 22, author: null },
  ];
  const extras = mergeReviewerAndApprover([], app, 658);
  assert.deepEqual(extras.map((m) => m.iid), [21, 22]);
});

test('mergeReviewerAndApprover: empty and missing lists', () => {
  assert.deepEqual(mergeReviewerAndApprover([], [], 1), []);
  assert.deepEqual(mergeReviewerAndApprover([], undefined, 1), []);
  assert.deepEqual(mergeReviewerAndApprover([{ project_id: 1, iid: 1, author: null }], undefined, 1), []);
});

test('mergeReviewerAndApprover: duplicates inside the approver list collapse', () => {
  const app = [
    { project_id: 1, iid: 30, author: { id: 3 } },
    { project_id: 1, iid: 30, author: { id: 3 } },
  ];
  assert.equal(mergeReviewerAndApprover([], app, 1).length, 1);
});

test('queueItemFromMr: viaGroup is set only when passed', () => {
  const mr = { project_id: 1, iid: 2, title: 't', author: null, web_url: 'x', labels: [] };
  const plain = queueItemFromMr(mr, { projectPath: 'p', asapLabel: 'asap', source: 'auto', now: 1 });
  assert.equal('viaGroup' in plain, false);
  const grouped = queueItemFromMr(mr, { projectPath: 'p', asapLabel: 'asap', source: 'auto', now: 1, viaGroup: true });
  assert.equal(grouped.viaGroup, true);
});

test('refreshItemFromMr: leaves viaGroup untouched', () => {
  const item = { key: '1:2', title: 'old', labels: [], asap: false, viaGroup: true };
  refreshItemFromMr(item, { title: 'new', labels: [] }, 'asap');
  assert.equal(item.viaGroup, true);
});

test('shortName: second and later words shrink to initials', () => {
  assert.equal(shortName('Alexander Vinogradov'), 'Alexander V.');
  assert.equal(shortName('Maria Petrova-Vodkina'), 'Maria P.');
  assert.equal(shortName('Anna Maria Krestovskaya'), 'Anna M. K.');
  assert.equal(shortName('José Álvarez'), 'José Á.'); // non-ASCII names keep their accents
});

test('shortName: single word, empty input and extra spaces', () => {
  assert.equal(shortName('vesmirov'), 'vesmirov');
  assert.equal(shortName('  Ivan   Petrov  '), 'Ivan P.');
  assert.equal(shortName(''), '');
  assert.equal(shortName(undefined), '');
});

test('shortPath: keeps the last path segment', () => {
  assert.equal(shortPath('platform-core/billing/py.payment-orchestrator'), 'py.payment-orchestrator');
  assert.equal(shortPath('acme/gateway'), 'gateway');
  assert.equal(shortPath('gateway'), 'gateway');
  assert.equal(shortPath(''), '');
});
