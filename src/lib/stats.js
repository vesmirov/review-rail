const DAY_MS = 864e5;

export function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function addDays(ts, days) {
  const d = new Date(ts);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

export function startOfWeek(now = Date.now()) {
  const d = new Date(startOfDay(now));
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

export function startOfMonth(now = Date.now()) {
  const d = new Date(startOfDay(now));
  d.setDate(1);
  return d.getTime();
}

export function computeStats(history, now = Date.now()) {
  const today = startOfDay(now);
  const week = startOfWeek(now);
  const month = startOfMonth(now);
  const count = (from) => history.filter((x) => x.completedAt >= from && x.completedAt <= now).length;
  const prevWeekStart = addDays(week, -7);
  const prevWeek = history.filter(
    (x) => x.completedAt >= prevWeekStart && x.completedAt < week
  ).length;
  const yesterdayStart = addDays(today, -1);
  const yesterday = history.filter(
    (x) => x.completedAt >= yesterdayStart && x.completedAt < today
  ).length;
  return {
    today: count(today),
    yesterday,
    week: count(week),
    month: count(month),
    prevWeek,
    total: history.length,
  };
}

export function monthTicks(weeks) {
  return weeks.map((week, i) => {
    if (i === 0) return '';
    const prev = new Date(weeks[i - 1][0].dayStart).getMonth();
    const cur = new Date(week[0].dayStart).getMonth();
    if (prev === cur) return '';
    return new Date(week[0].dayStart).toLocaleDateString('en-US', { month: 'short' });
  });
}

export function monthStartLabel(now = Date.now()) {
  const month = new Date(startOfMonth(now)).toLocaleDateString('en-US', { month: 'short' });
  return `since ${month} 1`;
}

export function activityWeeks(history, weeks = 16, now = Date.now()) {
  const today = startOfDay(now);
  const monday = startOfWeek(now);
  const counts = new Map();
  for (const x of history) {
    const day = startOfDay(x.completedAt);
    counts.set(day, (counts.get(day) || 0) + 1);
  }
  const max = Math.max(1, ...counts.values());
  const out = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const week = [];
    for (let d = 0; d < 7; d++) {
      const dayStart = addDays(monday, d - w * 7);
      if (dayStart > today) {
        week.push({ dayStart, count: 0, level: -1 });
        continue;
      }
      const count = counts.get(dayStart) || 0;
      week.push({ dayStart, count, level: count === 0 ? 0 : Math.ceil((count / max) * 4) });
    }
    out.push(week);
  }
  return out;
}

export function activitySeries(history, days = 28, now = Date.now()) {
  const today = startOfDay(now);
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const dayStart = addDays(today, -i);
    const dayEnd = addDays(dayStart, 1);
    const count = history.filter((x) => x.completedAt >= dayStart && x.completedAt < dayEnd).length;
    out.push({ dayStart, count });
  }
  return out;
}

export function ageText(ts, now = Date.now()) {
  const mins = Math.round((now - ts) / 60e3);
  if (mins < 60) return `${Math.max(mins, 1)} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h`;
  return `${Math.round(hours / 24)} d`;
}

export function whenText(ts, now = Date.now()) {
  const diff = Math.round((startOfDay(now) - startOfDay(ts)) / DAY_MS);
  if (diff === 0) return 'today';
  if (diff === 1) return 'yesterday';
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function shortDate(ts) {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
