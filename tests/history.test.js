import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  localDayStart,
  approvalEventToEntry,
  mergeHistory,
  reconcileApprovals,
} from '../src/lib/history.js';

const BASE = 'https://gitlab.corp.com';
const PATHS = new Map([[5, 'team/app']]);

const event = (over = {}) => ({
  target_type: 'MergeRequest',
  project_id: 5,
  target_iid: 12,
  target_title: 'Fix things',
  created_at: '2026-03-10T14:30:00.000+03:00',
  ...over,
});

const entry = (key, completedAt, how = 'approved') => ({
  key,
  title: key,
  projectPath: 'team/app',
  iid: 1,
  webUrl: '#',
  completedAt,
  how,
});

test('approvalEventToEntry: маппинг события аппрува', () => {
  const e = approvalEventToEntry(event(), PATHS, BASE);
  assert.equal(e.key, '5:12');
  assert.equal(e.title, 'Fix things');
  assert.equal(e.projectPath, 'team/app');
  assert.equal(e.webUrl, `${BASE}/team/app/-/merge_requests/12`);
  assert.equal(e.completedAt, Date.parse('2026-03-10T14:30:00.000+03:00'));
  assert.equal(e.how, 'approved');
});

test('approvalEventToEntry: не-MR события и битые данные отбрасываются', () => {
  assert.equal(approvalEventToEntry(event({ target_type: 'Issue' }), PATHS, BASE), null);
  assert.equal(approvalEventToEntry(event({ created_at: 'garbage' }), PATHS, BASE), null);
  assert.equal(approvalEventToEntry(null, PATHS, BASE), null);
});

test('approvalEventToEntry: неизвестный проект — без webUrl, но запись есть', () => {
  const e = approvalEventToEntry(event({ project_id: 99 }), PATHS, BASE);
  assert.equal(e.projectPath, '');
  assert.equal(e.webUrl, '');
  assert.equal(e.key, '99:12');
});

test('mergeHistory: дедупликация по MR и дню', () => {
  const day = Date.parse('2026-03-10T10:00:00Z');
  const existing = [entry('5:12', day)];
  const merged = mergeHistory(existing, [
    entry('5:12', day + 36e5),
    entry('5:13', day),
    null,
  ]);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged.map((e) => e.key).sort(), ['5:12', '5:13']);
});

test('mergeHistory: повторные аппрувы в разные дни — отдельные ревью', () => {
  const d1 = Date.parse('2026-03-10T10:00:00Z');
  const d2 = Date.parse('2026-03-12T10:00:00Z');
  const merged = mergeHistory([], [entry('5:12', d1), entry('5:12', d2)]);
  assert.equal(merged.length, 2);
});

test('mergeHistory: сортировка по убыванию даты и лимит', () => {
  const merged = mergeHistory([entry('a', 100)], [entry('b', 300), entry('c', 200)], 2);
  assert.deepEqual(merged.map((e) => e.key), ['b', 'c']);
});

test('reconcileApprovals: заменяет аппрув-записи с датой обнаружения на реальные даты из событий', () => {
  const today = Date.parse('2026-07-31T12:00:00Z');
  const real = Date.parse('2026-03-10T10:00:00Z');
  const history = [entry('5:12', today, 'approved')];
  const result = reconcileApprovals(history, [entry('5:12', real, 'approved')]);
  assert.equal(result.length, 1);
  assert.equal(result[0].completedAt, real);
});

test('reconcileApprovals: ручные и commented-записи не трогает', () => {
  const t = Date.parse('2026-07-31T12:00:00Z');
  const history = [entry('5:12', t, 'manual'), entry('5:13', t, 'commented')];
  const result = reconcileApprovals(history, [entry('5:14', t - 864e5, 'approved')]);
  assert.equal(result.length, 3);
});

test('localDayStart: обнуляет время в локальной зоне', () => {
  const ts = new Date(2026, 6, 31, 18, 45).getTime();
  assert.equal(localDayStart(ts), new Date(2026, 6, 31, 0, 0, 0, 0).getTime());
});
