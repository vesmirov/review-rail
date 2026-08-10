process.env.TZ = 'Europe/Berlin';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStats, activityWeeks, activitySeries } from '../src/lib/stats.js';
import { reconcileApprovals } from '../src/lib/history.js';

// In Berlin the CET -> CEST switch happens on March 29, 2026: that day has 23 hours.

test('DST: yesterday is computed by calendar day, not minus 24 hours', () => {
  const now = new Date(2026, 2, 30, 12, 0).getTime(); // March 30, the day after the switch
  const h = [
    { completedAt: new Date(2026, 2, 29, 10, 0).getTime() }, // yesterday
    { completedAt: new Date(2026, 2, 28, 23, 30).getTime() }, // the day before yesterday, late evening
  ];
  const s = computeStats(h, now);
  assert.equal(s.yesterday, 1, 'the day-before-yesterday evening must not count as yesterday');
});

test('DST: every activityWeeks cell starts at local midnight', () => {
  const now = new Date(2026, 3, 15, 12, 0).getTime(); // mid-April, the switch falls inside the window
  const weeks = activityWeeks([], 16, now);
  for (const week of weeks) {
    for (const day of week) {
      const d = new Date(day.dayStart);
      assert.equal(d.getHours(), 0, `not midnight: ${d.toString()}`);
      assert.equal(d.getMinutes(), 0);
    }
  }
});

test('DST: activityWeeks places a review into the correct day after the switch', () => {
  const now = new Date(2026, 3, 15, 12, 0).getTime();
  const reviewDay = new Date(2026, 3, 3, 15, 0); // April 3, after the switch
  const weeks = activityWeeks([{ completedAt: reviewDay.getTime() }], 16, now);
  const cell = weeks.flat().find((c) => {
    const d = new Date(c.dayStart);
    return d.getMonth() === 3 && d.getDate() === 3;
  });
  assert.ok(cell, 'the April 3 cell exists');
  assert.equal(cell.count, 1);
});

test('DST: activitySeries days start at local midnight', () => {
  const now = new Date(2026, 2, 31, 12, 0).getTime();
  const series = activitySeries([], 7, now);
  for (const day of series) {
    assert.equal(new Date(day.dayStart).getHours(), 0);
  }
});

test('reconcileApprovals: an old approval outside the events window survives', () => {
  const may = new Date(2026, 4, 10, 12, 0).getTime();
  const august = new Date(2026, 7, 1, 12, 0).getTime();
  const history = [
    { key: '5:12', title: 'MR', projectPath: 'p', iid: 12, webUrl: '', completedAt: may, how: 'approved' },
  ];
  const events = [
    { key: '5:12', title: 'MR', projectPath: 'p', iid: 12, webUrl: '', completedAt: august, how: 'approved' },
  ];
  const merged = reconcileApprovals(history, events);
  assert.equal(merged.length, 2, 'both approvals must be kept');
});

test('reconcileApprovals: a duplicate inside the window is replaced by the event', () => {
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
