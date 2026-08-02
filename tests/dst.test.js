process.env.TZ = 'Europe/Berlin';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStats, activityWeeks, activitySeries } from '../src/lib/stats.js';
import { reconcileApprovals } from '../src/lib/history.js';

// В Берлине 29 марта 2026 переход CET -> CEST: в сутках 23 часа.

test('DST: yesterday считается календарно, а не минус 24 часа', () => {
  const now = new Date(2026, 2, 30, 12, 0).getTime(); // 30 марта, день после перевода
  const h = [
    { completedAt: new Date(2026, 2, 29, 10, 0).getTime() }, // вчера
    { completedAt: new Date(2026, 2, 28, 23, 30).getTime() }, // позавчера, поздний вечер
  ];
  const s = computeStats(h, now);
  assert.equal(s.yesterday, 1, 'позавчерашний вечер не должен попадать во вчера');
});

test('DST: все ячейки activityWeeks начинаются в локальную полночь', () => {
  const now = new Date(2026, 3, 15, 12, 0).getTime(); // середина апреля, переход внутри окна
  const weeks = activityWeeks([], 16, now);
  for (const week of weeks) {
    for (const day of week) {
      const d = new Date(day.dayStart);
      assert.equal(d.getHours(), 0, `не полночь: ${d.toString()}`);
      assert.equal(d.getMinutes(), 0);
    }
  }
});

test('DST: activityWeeks кладёт ревью в правильный день после перевода', () => {
  const now = new Date(2026, 3, 15, 12, 0).getTime();
  const reviewDay = new Date(2026, 3, 3, 15, 0); // 3 апреля, после перевода
  const weeks = activityWeeks([{ completedAt: reviewDay.getTime() }], 16, now);
  const cell = weeks.flat().find((c) => {
    const d = new Date(c.dayStart);
    return d.getMonth() === 3 && d.getDate() === 3;
  });
  assert.ok(cell, 'ячейка 3 апреля существует');
  assert.equal(cell.count, 1);
});

test('DST: activitySeries начинается в локальные полуночи', () => {
  const now = new Date(2026, 2, 31, 12, 0).getTime();
  const series = activitySeries([], 7, now);
  for (const day of series) {
    assert.equal(new Date(day.dayStart).getHours(), 0);
  }
});

test('reconcileApprovals: старый апрув вне окна событий выживает', () => {
  const may = new Date(2026, 4, 10, 12, 0).getTime();
  const august = new Date(2026, 7, 1, 12, 0).getTime();
  const history = [
    { key: '5:12', title: 'MR', projectPath: 'p', iid: 12, webUrl: '', completedAt: may, how: 'approved' },
  ];
  const events = [
    { key: '5:12', title: 'MR', projectPath: 'p', iid: 12, webUrl: '', completedAt: august, how: 'approved' },
  ];
  const merged = reconcileApprovals(history, events);
  assert.equal(merged.length, 2, 'оба апрува должны сохраниться');
});

test('reconcileApprovals: дубликат внутри окна заменяется событием', () => {
  const t = new Date(2026, 7, 1, 12, 0).getTime();
  const history = [
    { key: '5:12', title: 'stale', projectPath: 'p', iid: 12, webUrl: '', completedAt: t + 60e3, how: 'approved' },
  ];
  const events = [
    { key: '5:12', title: 'fresh', projectPath: 'p', iid: 12, webUrl: '', completedAt: t, how: 'approved' },
  ];
  const merged = reconcileApprovals(history, events);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].title, 'fresh');
});
