import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hintForStatus, normalizeApiPath, apiErrorEntry, pushLog } from '../src/lib/log.js';

test('hintForStatus: clear hints for common statuses', () => {
  assert.match(hintForStatus(401), /Reset token/);
  assert.match(hintForStatus(403), /read_api/);
  assert.match(hintForStatus(404), /GitLab version/);
  assert.match(hintForStatus(429), /Rate limited/);
  assert.match(hintForStatus(0), /VPN/);
  assert.match(hintForStatus(502), /server error/);
  assert.equal(hintForStatus(422), null);
});

test('normalizeApiPath: numeric ids and query strings are collapsed', () => {
  assert.equal(
    normalizeApiPath('/projects/42/merge_requests/581/approvals'),
    '/projects/:id/merge_requests/:id/approvals'
  );
  assert.equal(
    normalizeApiPath('/merge_requests?scope=all&reviewer_username=x'),
    '/merge_requests'
  );
  assert.equal(normalizeApiPath('/users/7/events'), '/users/:id/events');
});

test('apiErrorEntry: builds message, detail, and hint', () => {
  const err = new Error('GitLab API 403');
  err.status = 403;
  err.path = '/projects/42/merge_requests/581/approvals';
  err.gitlabMessage = 'insufficient_scope';
  const entry = apiErrorEntry(err, 1000);
  assert.equal(entry.level, 'error');
  assert.equal(entry.source, 'api');
  assert.equal(entry.message, 'GET /projects/:id/merge_requests/:id/approvals → 403');
  assert.match(entry.detail, /\/projects\/42\/merge_requests\/581\/approvals/);
  assert.match(entry.detail, /insufficient_scope/);
  assert.match(entry.hint, /read_api/);
  assert.equal(entry.ts, 1000);
});

test('apiErrorEntry: network error without a status', () => {
  const err = new Error('GitLab is unreachable');
  err.status = 0;
  err.path = '/user';
  const entry = apiErrorEntry(err, 1);
  assert.equal(entry.message, 'GET /user → network error');
  assert.match(entry.hint, /VPN/);
});

const info = (ts) => ({ ts, level: 'info', source: 'sync', message: `sync ${ts}`, count: 1 });
const err = (ts) => ({ ts, level: 'error', source: 'api', message: `err ${ts}`, count: 1 });

test('pushLog: new entries go to the front, nothing is collapsed', () => {
  const list = [];
  pushLog(list, info(1));
  pushLog(list, info(2));
  pushLog(list, info(3));
  assert.deepEqual(list.map((e) => e.ts), [3, 2, 1]);
  assert.ok(list.every((e) => e.count === 1));
});

test('pushLog: identical consecutive entries stay separate rows', () => {
  const list = [];
  const same = (ts) => ({ ts, level: 'error', source: 'api', message: 'GET /x → 401', count: 1 });
  pushLog(list, same(1));
  pushLog(list, same(2));
  assert.equal(list.length, 2);
});

test('pushLog: a level quota evicts only entries of the same level', () => {
  const list = [];
  pushLog(list, err(1));
  for (let i = 2; i <= 5; i++) pushLog(list, info(i), { error: 2, info: 3 });
  assert.deepEqual(list.map((e) => e.ts), [5, 4, 3, 1]);
  assert.equal(list.filter((e) => e.level === 'error').length, 1);
});

test('pushLog: errors are not washed out by a stream of info entries and vice versa', () => {
  const list = [];
  const limits = { error: 2, info: 2 };
  pushLog(list, err(1), limits);
  pushLog(list, err(2), limits);
  pushLog(list, err(3), limits);
  for (let i = 4; i <= 10; i++) pushLog(list, info(i), limits);
  assert.deepEqual(
    list.map((e) => `${e.level}:${e.ts}`),
    ['info:10', 'info:9', 'error:3', 'error:2']
  );
});
