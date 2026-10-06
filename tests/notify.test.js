import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notificationFor, notificationUrl } from '../src/lib/notify.js';

const settings = { baseUrl: 'https://gl.test', username: 'me' };
const item = (extra = {}) => ({
  title: 'Add retries',
  author: 'Alice Smith',
  projectPath: 'backend/api-gateway',
  iid: 581,
  webUrl: 'https://gl.test/backend/api-gateway/-/merge_requests/581',
  asap: false,
  reReview: false,
  ...extra,
});

test('nothing new: no notification', () => {
  assert.equal(notificationFor([], settings), null);
});

test('one new MR: links to the MR, names it in the message', () => {
  assert.deepEqual(notificationFor([item()], settings), {
    id: 'rr:https://gl.test/backend/api-gateway/-/merge_requests/581',
    title: 'Review requested',
    message: 'Add retries',
    contextMessage: 'api-gateway!581 · Alice Smith',
  });
});

test('one urgent MR says so, even when it is a re-review', () => {
  assert.equal(notificationFor([item({ asap: true, reReview: true })], settings).title, 'Urgent review requested');
});

test('one MR back for another round says "again"', () => {
  assert.equal(notificationFor([item({ reReview: true })], settings).title, 'Review requested again');
});

test('several MRs: one notification, urgent first, linking to the GitLab review list', () => {
  const n = notificationFor(
    [item({ title: 'A' }), item({ title: 'B', asap: true }), item({ title: 'C' })],
    { baseUrl: 'https://gl.test', username: 'j.doe' }
  );
  assert.equal(n.id, 'rr:https://gl.test/dashboard/merge_requests?reviewer_username=j.doe');
  assert.equal(n.title, '3 new reviews, 1 urgent');
  assert.equal(n.message, 'B\nA\nC');
  assert.equal(n.contextMessage, 'Opens your review list in GitLab');
});

test('more than three MRs: the rest are counted, not listed', () => {
  const n = notificationFor(['A', 'B', 'C', 'D', 'E'].map((title) => item({ title })), settings);
  assert.equal(n.title, '5 new reviews');
  assert.equal(n.message, 'A\nB\nC\nand 2 more');
});

test('a click opens only URLs on the configured GitLab origin', () => {
  assert.equal(
    notificationUrl('rr:https://gl.test/g/p/-/merge_requests/5', 'https://gl.test'),
    'https://gl.test/g/p/-/merge_requests/5'
  );
  assert.equal(notificationUrl('rr:https://evil.test/x', 'https://gl.test'), null);
  assert.equal(notificationUrl('other-extension-id', 'https://gl.test'), null);
  assert.equal(notificationUrl('rr:not a url', 'https://gl.test'), null);
});
