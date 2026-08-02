import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectPathFromUrl, normalizeBaseUrl, connectErrorMessage, api, apiAll } from '../src/lib/gitlab.js';

const BASE = 'https://gitlab.corp.com';

test('projectPathFromUrl: извлекает путь проекта из web_url', () => {
  assert.equal(projectPathFromUrl(`${BASE}/org/sub/app/-/merge_requests/12`), 'org/sub/app');
  assert.equal(projectPathFromUrl('garbage'), '');
});

test('connectErrorMessage: человеческие сообщения вместо кодов', () => {
  const err = (status) => Object.assign(new Error(`GitLab API ${status}: /user`), { status });
  assert.match(connectErrorMessage(err(401), BASE), /rejected the token/);
  assert.match(connectErrorMessage(err(403), BASE), /read_api/);
  assert.match(connectErrorMessage(err(404), BASE), /doesn't look like a GitLab/);
  assert.match(connectErrorMessage(err(0), BASE), /Can't reach/);
  assert.match(connectErrorMessage(err(502), BASE), /server error/);
  assert.equal(connectErrorMessage(err(422), BASE), 'GitLab API 422: /user');
});

test('normalizeBaseUrl: обрезает слэши, отклоняет не-http', () => {
  assert.equal(normalizeBaseUrl('  https://git.corp/// '), 'https://git.corp');
  assert.equal(normalizeBaseUrl('git.corp'), null);
  assert.equal(normalizeBaseUrl(''), null);
});

test('normalizeBaseUrl: капс-схема принимается, путь сохраняется', () => {
  assert.equal(normalizeBaseUrl('HTTPS://Git.Corp'), 'https://git.corp');
  assert.equal(normalizeBaseUrl('https://host.com/gitlab/'), 'https://host.com/gitlab');
  assert.equal(normalizeBaseUrl('https://host.com/'), 'https://host.com');
});

test('apiAll: собирает страницы до неполной', async () => {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(url);
    const page = Number(new URL(url).searchParams.get('page'));
    const items = page === 1 ? Array.from({ length: 100 }, (_, i) => i) : [100, 101, 102];
    return { ok: true, json: async () => items };
  };
  try {
    const settings = { baseUrl: 'https://git.corp', token: 't' };
    const all = await apiAll(settings, '/merge_requests?per_page=100');
    assert.equal(all.length, 103);
    assert.equal(calls.length, 2);
    assert.match(calls[0], /per_page=100&page=1/);
  } finally {
    globalThis.fetch = orig;
  }
});

test('api: не-JSON ответ даёт понятную ошибку про SSO/прокси', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => { throw new SyntaxError('Unexpected token <'); } });
  try {
    const settings = { baseUrl: 'https://git.corp', token: 't' };
    await assert.rejects(() => api(settings, '/user'), /SSO or proxy/);
  } finally {
    globalThis.fetch = orig;
  }
});
