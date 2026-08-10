import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  startOfDay,
  startOfWeek,
  startOfMonth,
  computeStats,
  activitySeries,
  activityWeeks,
  monthTicks,
  monthStartLabel,
  ageText,
  whenText,
} from '../src/lib/stats.js';

const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();
const NOW = at(2026, 7, 31, 15);

test('startOfWeek: week starts on monday', () => {
  assert.equal(startOfWeek(NOW), at(2026, 7, 27, 0));
  assert.equal(startOfWeek(at(2026, 7, 27, 0)), at(2026, 7, 27, 0));
  assert.equal(startOfWeek(at(2026, 7, 26)), at(2026, 7, 20, 0));
});

test('startOfMonth and startOfDay', () => {
  assert.equal(startOfMonth(NOW), at(2026, 7, 1, 0));
  assert.equal(startOfDay(NOW), at(2026, 7, 31, 0));
});

test('computeStats: day, week and month boundaries', () => {
  const history = [
    { completedAt: at(2026, 7, 31, 9) },
    { completedAt: at(2026, 7, 30) },
    { completedAt: at(2026, 7, 27, 0) },
    { completedAt: at(2026, 7, 26) },
    { completedAt: at(2026, 7, 1, 0) },
    { completedAt: at(2026, 6, 30) },
  ];
  const s = computeStats(history, NOW);
  assert.equal(s.today, 1);
  assert.equal(s.week, 3);
  assert.equal(s.month, 5);
  assert.equal(s.total, 6);
});

test('computeStats: empty history', () => {
  assert.deepEqual(computeStats([], NOW), { today: 0, yesterday: 0, week: 0, month: 0, prevWeek: 0, total: 0 });
});

test('activitySeries: 28 daily buckets, each count lands in its own day', () => {
  const history = [
    { completedAt: at(2026, 7, 31, 1) },
    { completedAt: at(2026, 7, 31, 23) },
    { completedAt: at(2026, 7, 4, 12) },
    { completedAt: at(2026, 7, 3, 12) },
  ];
  const s = activitySeries(history, 28, NOW);
  assert.equal(s.length, 28);
  assert.equal(s[27].count, 2);
  assert.equal(s[0].dayStart, at(2026, 7, 4, 0));
  assert.equal(s[0].count, 1);
  assert.equal(s.reduce((a, d) => a + d.count, 0), 3);
});

test('activityWeeks: 16 weeks of 7 days, monday first, future days marked', () => {
  const weeks = activityWeeks([], 16, NOW);
  assert.equal(weeks.length, 16);
  assert.ok(weeks.every((w) => w.length === 7));
  const lastWeek = weeks[15];
  assert.equal(lastWeek[0].dayStart, at(2026, 7, 27, 0));
  assert.equal(lastWeek[4].dayStart, at(2026, 7, 31, 0));
  assert.equal(lastWeek[4].level, 0);
  assert.equal(lastWeek[5].level, -1);
  assert.equal(lastWeek[6].level, -1);
});

test('activityWeeks: levels are proportional to the maximum', () => {
  const history = [
    { completedAt: at(2026, 7, 31, 10) },
    { completedAt: at(2026, 7, 31, 11) },
    { completedAt: at(2026, 7, 31, 12) },
    { completedAt: at(2026, 7, 31, 13) },
    { completedAt: at(2026, 7, 30, 10) },
  ];
  const weeks = activityWeeks(history, 2, NOW);
  const lastWeek = weeks[1];
  assert.equal(lastWeek[4].count, 4);
  assert.equal(lastWeek[4].level, 4);
  assert.equal(lastWeek[3].count, 1);
  assert.equal(lastWeek[3].level, 1);
  assert.equal(lastWeek[2].count, 0);
  assert.equal(lastWeek[2].level, 0);
});

test('ageText: minutes, hours, days', () => {
  assert.equal(ageText(NOW - 30e3, NOW), '1 min');
  assert.equal(ageText(NOW - 20 * 60e3, NOW), '20 min');
  assert.equal(ageText(NOW - 5 * 36e5, NOW), '5 h');
  assert.equal(ageText(NOW - 2 * 864e5, NOW), '2 d');
});

test('whenText: today, yesterday, date', () => {
  assert.equal(whenText(at(2026, 7, 31, 1), NOW), 'today');
  assert.equal(whenText(at(2026, 7, 30, 23), NOW), 'yesterday');
  assert.equal(whenText(at(2026, 7, 20), NOW), 'Jul 20');
});

test('computeStats: prevWeek counts only the previous calendar week', () => {
  const now = Date.parse('2026-08-02T12:00:00'); // sunday
  const thisWeek = Date.parse('2026-07-29T10:00:00');
  const prevWeek1 = Date.parse('2026-07-22T10:00:00');
  const prevWeek2 = Date.parse('2026-07-26T23:00:00'); // sunday of the previous week
  const older = Date.parse('2026-07-10T10:00:00');
  const h = [thisWeek, prevWeek1, prevWeek2, older].map((completedAt) => ({ completedAt }));
  const s = computeStats(h, now);
  assert.equal(s.week, 1);
  assert.equal(s.prevWeek, 2);
});

test('computeStats: prevWeek is zero on empty history', () => {
  assert.equal(computeStats([], Date.parse('2026-08-02T12:00:00')).prevWeek, 0);
});

test('monthTicks: tick on the column where the month changes', () => {
  const now = Date.parse('2026-08-02T12:00:00');
  const weeks = activityWeeks([], 16, now);
  const ticks = monthTicks(weeks);
  assert.equal(ticks.length, 16);
  assert.equal(ticks[0], '');
  const named = ticks.filter(Boolean);
  assert.deepEqual(named, ['May', 'Jun', 'Jul']);
  for (let i = 1; i < weeks.length; i++) {
    const prevM = new Date(weeks[i - 1][0].dayStart).getMonth();
    const curM = new Date(weeks[i][0].dayStart).getMonth();
    assert.equal(Boolean(ticks[i]), prevM !== curM, `column ${i}`);
  }
});

test('monthStartLabel: label for the start of the current month', () => {
  assert.equal(monthStartLabel(Date.parse('2026-08-02T12:00:00')), 'since Aug 1');
  assert.equal(monthStartLabel(Date.parse('2026-01-15T12:00:00')), 'since Jan 1');
});

test('computeStats: yesterday counts only the previous day', () => {
  const now = Date.parse('2026-08-02T12:00:00');
  const h = [
    { completedAt: Date.parse('2026-08-02T09:00:00') },
    { completedAt: Date.parse('2026-08-01T23:30:00') },
    { completedAt: Date.parse('2026-08-01T08:00:00') },
    { completedAt: Date.parse('2026-07-31T10:00:00') },
  ];
  const s = computeStats(h, now);
  assert.equal(s.today, 1);
  assert.equal(s.yesterday, 2);
});
