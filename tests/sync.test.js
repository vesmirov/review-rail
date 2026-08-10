// Integration tests for sync(): the real src/bg/sync.js, with stubs only for
// the global chrome and fetch - exactly what store.js and api.js touch.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ---------- chrome.storage stub ----------
let store = {};
function fromKeys(keys) {
  if (typeof keys === 'string') return { [keys]: store[keys] };
  if (Array.isArray(keys)) return Object.fromEntries(keys.map((k) => [k, store[k]]));
  return Object.fromEntries(
    Object.entries(keys).map(([k, def]) => [k, store[k] === undefined ? def : store[k]])
  );
}
globalThis.chrome = {
  storage: {
    local: {
      get: async (keys) => fromKeys(keys),
      set: async (obj) => Object.assign(store, obj),
    },
  },
  action: {
    setBadgeBackgroundColor: async () => {},
    setBadgeText: async () => {},
  },
};

// ---------- fetch stub ----------
const ok = (data) => ({ ok: true, status: 200, json: async () => data });
const fail = (status = 503) => ({
  ok: false,
  status,
  json: async () => ({ message: 'boom' }),
});
let routes = {};
let calls = {};
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('reviewer_username=')) return routes.assigned;
  if (u.includes('approver_ids[]=')) return routes.approvers;
  if (u.includes('/reviewers')) return routes.reviewers;
  if (u.includes('/approvals')) return routes.approvals;
  if (u.includes('/pipelines')) {
    calls.pipelines++;
    return routes.pipelines;
  }
  if (u.includes('/labels')) return ok([]);
  if (u.includes('/events?action=approved')) return routes.events;
  if (/\/merge_requests\/\d+\?*$/.test(u)) return routes.mr;
  throw new Error(`unmocked url: ${u}`);
};

const { sync } = await import('../src/bg/sync.js');

const openMr = {
  project_id: 1,
  iid: 5,
  title: 'MR',
  state: 'opened',
  author: { id: 99, name: 'Alice' },
  web_url: 'https://gl.test/g/p/-/merge_requests/5',
  created_at: '2026-07-01T10:00:00Z',
  updated_at: '2026-07-02T10:00:00Z',
  labels: [],
  head_pipeline: null,
};

const queueItem = (extra = {}) => ({
  key: '1:5',
  projectId: 1,
  iid: 5,
  title: 'MR',
  author: 'Alice',
  projectPath: 'g/p',
  webUrl: 'https://gl.test/g/p/-/merge_requests/5',
  addedAt: 1e12,
  requestedAt: 1e12,
  createdAt: Date.parse('2026-07-01T10:00:00Z'),
  labels: [],
  source: 'auto',
  asap: false,
  ...extra,
});

beforeEach(() => {
  store = {
    settings: {
      baseUrl: 'https://gl.test',
      token: 't',
      username: 'me',
      userId: 7,
      asapLabel: 'asap',
    },
    queue: [queueItem()],
    history: [],
    waiting: [],
    hidden: [],
    snoozed: {},
    backfillDoneAt: Date.now(),
  };
  routes = {
    assigned: ok([]),
    approvers: ok([]),
    reviewers: ok([]),
    approvals: ok({ approved_by: [] }),
    mr: ok(openMr),
    pipelines: ok([]),
    events: ok([]),
  };
  calls = { pipelines: 0 };
});

const approvedEntry = () => ({
  key: '1:5',
  title: 'MR',
  projectPath: 'g/p',
  iid: 5,
  webUrl: 'https://gl.test/g/p/-/merge_requests/5',
  completedAt: Date.parse('2026-08-01T12:00:00Z'),
  how: 'approved',
});

test('removed from review: open MR gone from the lists, /reviewers confirms absence, card leaves without credit', async () => {
  const res = await sync();
  assert.equal(res.ok, true);
  assert.deepEqual(store.queue, []);
  assert.deepEqual(store.history, []); // review not counted
  assert.deepEqual(store.waiting, []);
});

test('failed /reviewers request keeps the card (an error does not mean "not a reviewer")', async () => {
  routes.reviewers = fail();
  const res = await sync();
  assert.equal(res.ok, true);
  assert.equal(store.queue.length, 1);
  assert.equal(store.queue[0].key, '1:5');
});

test('group card (viaGroup) is not treated as removed: it has no reviewer record', async () => {
  store.queue = [queueItem({ viaGroup: true })];
  await sync();
  assert.equal(store.queue.length, 1);
  assert.equal(store.queue[0].viaGroup, true);
});

test('failed /pipelines call does not overwrite the last known pipeline status', async () => {
  const listMr = { ...openMr };
  delete listMr.head_pipeline; // list MR without head_pipeline -> triggers a /pipelines request
  store.queue = [queueItem({ pipeline: 'failed', updatedAt: 'stale' })];
  routes.assigned = ok([listMr]);
  routes.reviewers = ok([{ user: { id: 7 }, state: 'unreviewed', created_at: null }]);
  routes.pipelines = fail();
  await sync();
  assert.equal(store.queue[0].pipeline, 'failed');
});

test('card with unknown pipeline (null) is re-polled on the fast path and repaired', async () => {
  store.queue = [queueItem({ pipeline: null, updatedAt: openMr.updated_at })];
  routes.assigned = ok([openMr]); // updated_at unchanged -> fast path
  routes.reviewers = ok([{ user: { id: 7 }, state: 'unreviewed', created_at: null }]);
  routes.pipelines = ok([{ status: 'failed' }]);
  await sync();
  assert.equal(store.queue[0].pipeline, 'failed');
});

test('empty /pipelines response yields a none marker and is not re-polled again', async () => {
  store.queue = [queueItem({ pipeline: null, updatedAt: openMr.updated_at })];
  routes.assigned = ok([openMr]);
  routes.reviewers = ok([{ user: { id: 7 }, state: 'unreviewed', created_at: null }]);
  await sync();
  assert.equal(store.queue[0].pipeline, 'none');
  const after = calls.pipelines;
  await sync();
  assert.equal(calls.pipelines, after); // second sync did not fetch pipelines
});

test('revoked approval: card returns to the queue, credit is removed from history', async () => {
  store.queue = [];
  store.history = [approvedEntry()];
  routes.assigned = ok([openMr]);
  routes.reviewers = ok([{ user: { id: 7 }, state: 'unapproved', created_at: null }]);
  await sync();
  assert.equal(store.queue.length, 1);
  assert.equal(store.queue[0].key, '1:5');
  assert.equal(typeof store.queue[0].requestedAt, 'number'); // age counter restarted
  assert.deepEqual(store.history, []);
  assert.equal(typeof store.revokedApprovals['1:5'], 'number');
});

test('revoked approval: event backfill does not resurrect the removed credit', async () => {
  store.queue = [];
  store.history = [approvedEntry()];
  store.projectPaths = { 1: 'g/p' };
  routes.assigned = ok([openMr]);
  routes.reviewers = ok([{ user: { id: 7 }, state: 'unapproved', created_at: null }]);
  // GitLab keeps the "approved" event in the feed even after a revoke
  routes.events = ok([
    {
      target_type: 'MergeRequest',
      project_id: 1,
      target_iid: 5,
      target_title: 'MR',
      created_at: '2026-08-01T12:00:00Z',
    },
  ]);
  await sync();
  assert.deepEqual(store.history, []);
  assert.equal(store.queue.length, 1);
});

test('group MR whose approval was reset returns to the queue', async () => {
  store.queue = [];
  store.history = [approvedEntry()];
  routes.assigned = ok([]);
  routes.approvers = ok([openMr]);
  routes.reviewers = ok([]); // no reviewer record - the card is a group one
  await sync();
  assert.equal(store.queue.length, 1);
  assert.equal(store.queue[0].viaGroup, true);
  assert.deepEqual(store.history, []);
});

test('an approval still in force does not return the card or touch history', async () => {
  store.queue = [];
  store.history = [approvedEntry()];
  routes.assigned = ok([openMr]);
  routes.reviewers = ok([{ user: { id: 7 }, state: 'approved', created_at: null }]);
  routes.approvals = ok({ approved_by: [{ user: { id: 7 } }] });
  await sync();
  assert.deepEqual(store.queue, []);
  assert.equal(store.history.length, 1);
});

test('failed /approvals on a group MR: the card does not return this cycle (an error does not mean the approval was reset)', async () => {
  store.queue = [];
  store.history = [approvedEntry()];
  routes.assigned = ok([]);
  routes.approvers = ok([openMr]);
  routes.approvals = fail();
  routes.reviewers = ok([]);
  await sync();
  assert.deepEqual(store.queue, []);
  assert.equal(store.history.length, 1);
});

test('a "request changes" verdict is caught even when updated_at is unchanged (delta sync does not swallow it)', async () => {
  store.queue = [queueItem({ updatedAt: openMr.updated_at })];
  routes.assigned = ok([openMr]); // MR is in the list, updated_at unchanged
  routes.reviewers = ok([
    { user: { id: 7 }, state: 'requested_changes', created_at: '2026-07-01T12:00:00Z' },
  ]);
  await sync();
  assert.deepEqual(store.queue, []);
  assert.equal(store.waiting.length, 1);
  assert.equal(store.waiting[0].state, 'requested_changes');
  assert.equal(store.history.length, 1);
  assert.equal(store.history[0].how, 'changes_requested');
});
