// Интеграционные тесты sync(): настоящий src/bg/sync.js, стабы только для
// глобальных chrome и fetch — ровно то, что трогают store.js и api.js.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ---------- chrome.storage стаб ----------
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

// ---------- fetch стаб ----------
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
  if (u.includes('/events?action=approved')) return ok([]);
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
  };
  calls = { pipelines: 0 };
});

test('снятие с ревью: открытый MR исчез из списков, reviewers подтвердил отсутствие — карточка уходит без зачёта', async () => {
  const res = await sync();
  assert.equal(res.ok, true);
  assert.deepEqual(store.queue, []);
  assert.deepEqual(store.history, []); // ревью не засчитано
  assert.deepEqual(store.waiting, []);
});

test('сбой запроса reviewers — карточка остаётся (ошибка не значит «не ревьюер»)', async () => {
  routes.reviewers = fail();
  const res = await sync();
  assert.equal(res.ok, true);
  assert.equal(store.queue.length, 1);
  assert.equal(store.queue[0].key, '1:5');
});

test('групповая карточка (viaGroup) не считается снятой: у неё нет записи ревьюера', async () => {
  store.queue = [queueItem({ viaGroup: true })];
  await sync();
  assert.equal(store.queue.length, 1);
  assert.equal(store.queue[0].viaGroup, true);
});

test('сбой /pipelines не затирает последний известный статус пайплайна', async () => {
  const listMr = { ...openMr };
  delete listMr.head_pipeline; // MR из списка без head_pipeline -> идёт запрос /pipelines
  store.queue = [queueItem({ pipeline: 'failed', updatedAt: 'stale' })];
  routes.assigned = ok([listMr]);
  routes.reviewers = ok([{ user: { id: 7 }, state: 'unreviewed', created_at: null }]);
  routes.pipelines = fail();
  await sync();
  assert.equal(store.queue[0].pipeline, 'failed');
});

test('карточка с неизвестным пайплайном (null) перепрашивается на быстром пути и чинится', async () => {
  store.queue = [queueItem({ pipeline: null, updatedAt: openMr.updated_at })];
  routes.assigned = ok([openMr]); // updated_at не менялся -> быстрый путь
  routes.reviewers = ok([{ user: { id: 7 }, state: 'unreviewed', created_at: null }]);
  routes.pipelines = ok([{ status: 'failed' }]);
  await sync();
  assert.equal(store.queue[0].pipeline, 'failed');
});

test('пустой ответ /pipelines даёт маркер none и больше не перепрашивается', async () => {
  store.queue = [queueItem({ pipeline: null, updatedAt: openMr.updated_at })];
  routes.assigned = ok([openMr]);
  routes.reviewers = ok([{ user: { id: 7 }, state: 'unreviewed', created_at: null }]);
  await sync();
  assert.equal(store.queue[0].pipeline, 'none');
  const after = calls.pipelines;
  await sync();
  assert.equal(calls.pipelines, after); // второй синк не ходил за пайплайнами
});

test('вердикт «request changes» ловится даже при неизменном updated_at (дельта-синк не глотает его)', async () => {
  store.queue = [queueItem({ updatedAt: openMr.updated_at })];
  routes.assigned = ok([openMr]); // MR в списке, updated_at не менялся
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
