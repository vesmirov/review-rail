import { partitionQueue, labelTextColor, sortLabels, shortName, shortPath } from '../lib/queue.js';
import {
  computeStats,
  activityWeeks,
  ageText,
  whenText,
  shortDate,
  monthTicks,
  monthStartLabel,
} from '../lib/stats.js';

const hasChrome = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;

const DEMO_STATE = {
  settings: { baseUrl: 'https://gitlab.example.com', username: 'demo', asapLabel: 'asap' },
  queue: [
    { key: '1:311', title: 'Hotfix: rate limiter drops valid sessions', projectPath: 'acme/gateway', iid: 311, author: 'Alex P.', webUrl: '#', createdAt: Date.now() - 40 * 60e3, labels: ['asap', 'backend'], projectId: 1, source: 'auto', asap: true, pipeline: 'running' },
    { key: '1:581', title: '[APP-2145] Rework refund processing logic', projectPath: 'acme/py.api-gateway', iid: 581, author: 'Robin V.', webUrl: '#', createdAt: Date.now() - 3 * 864e5, labels: ['refactoring', 'billing'], projectId: 1, source: 'auto', asap: false, pipeline: 'failed' },
    { key: '1:564', title: '[APP-2044] Account cards', projectPath: 'acme/py.api-gateway', iid: 564, author: 'Sam K.', webUrl: '#', createdAt: Date.now() - 6 * 864e5, labels: [], projectId: 1, source: 'auto', asap: false, pipeline: 'passed', viaGroup: true },
    { key: '1:552', title: '[APP-2001] Extract limits configuration', projectPath: 'acme/py.api-gateway', iid: 552, author: 'Dana S.', webUrl: '#', createdAt: Date.now() - 9 * 864e5, labels: ['backend', 'config', 'tech-debt', 'infra'], projectId: 1, source: 'auto', asap: false },
  ],
  history: Array.from({ length: 120 }, (_, i) => ({
    key: `h${i}`, title: `Reviewed MR #${500 - i}`, projectPath: 'acme/billing', iid: 500 - i,
    webUrl: '#', completedAt: Date.now() - Math.floor(i * 0.9) * 864e5 - (i % 5) * 36e5,
    how: ['approved', 'approved', 'commented', 'changes_requested'][i % 4],
  })),
  waiting: [
    { key: '1:582', title: '[APP-2090] Login as another user', projectPath: 'acme/py.api-gateway', iid: 582, author: 'Morgan L.', webUrl: '#', createdAt: Date.now() - 12 * 864e5, labels: ['asap', 'backend'], projectId: 1, state: 'requested_changes' },
    { key: '1:590', title: '[APP-1870] Webhooks hotfix', projectPath: 'acme/webhooks', iid: 301, author: 'Dana S.', webUrl: '#', createdAt: Date.now() - 3 * 864e5, labels: [], projectId: 1, state: 'requested_changes' },
    { key: '1:571', title: '[APP-2030] Top-up processing trigger', projectPath: 'acme/py.api-gateway', iid: 571, author: 'Robin V.', webUrl: '#', createdAt: Date.now() - 4 * 864e5, labels: ['refactoring'], projectId: 1, state: 'reviewed' },
  ],
  hidden: [
    { key: '1:511', title: '[APP-1998] Legacy balance migration', projectPath: 'acme/py.api-gateway', iid: 511, author: 'Alex P.', webUrl: '#', hiddenAt: Date.now() - 864e5 },
  ],
  labelColors: {
    1: { asap: '#dc3545', backend: '#428fdc', refactoring: '#6e49cb', billing: '#00b140', config: '#ed9121', 'tech-debt': '#666666', infra: '#009966' },
  },
  lastSync: Date.now() - 2 * 60e3,
  lastError: null,
  syncing: false,
  syncStartedAt: null,
};

async function loadState() {
  if (!hasChrome) return DEMO_STATE;
  return chrome.storage.local.get({
    settings: null,
    queue: [],
    history: [],
    waiting: [],
    hidden: [],
    labelColors: {},
    logs: [],
    logsSeenAt: null,
    lastSync: null,
    lastError: null,
    syncing: false,
    syncStartedAt: null,
  });
}

function send(msg) {
  if (!hasChrome) return Promise.resolve({ ok: true });
  return chrome.runtime.sendMessage(msg);
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

const ICONS = {
  grip: '<g fill="currentColor" stroke="none"><circle cx="9" cy="5" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="9" cy="19" r="1.6"/><circle cx="15" cy="5" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="15" cy="19" r="1.6"/></g>',
  octagon: '<path d="M9 3h6l6 6v6l-6 6h-6l-6 -6v-6z"/><path d="M9 12h6"/>',
  message: '<path d="M8 9h8"/><path d="M8 13h6"/><path d="M18 4a3 3 0 0 1 3 3v8a3 3 0 0 1 -3 3h-5l-5 3v-3h-2a3 3 0 0 1 -3 -3v-8a3 3 0 0 1 3 -3h12z"/>',
  eyeOff: '<path d="M10.585 10.587a2 2 0 0 0 2.829 2.828"/><path d="M16.681 16.673a8.717 8.717 0 0 1 -4.681 1.327c-3.6 0 -6.6 -2 -9 -6c1.272 -2.12 2.712 -3.678 4.32 -4.674m2.86 -1.146a9.055 9.055 0 0 1 1.82 -.18c3.6 0 6.6 2 9 6c-.666 1.11 -1.379 2.067 -2.138 2.87"/><path d="M3 3l18 18"/>',
  eye: '<path d="M10 12a2 2 0 1 0 4 0a2 2 0 0 0 -4 0"/><path d="M21 12c-2.4 4 -5.4 6 -9 6c-3.6 0 -6.6 -2 -9 -6c2.4 -4 5.4 -6 9 -6c3.6 0 6.6 2 9 6"/>',
  chevron: '<path d="M9 6l6 6l-6 6"/>',
  users: '<path d="M9 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0" transform="translate(-2 0)"/><path d="M1 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2"/><path d="M17 3.13a4 4 0 0 1 0 7.75"/><path d="M22 21v-2a4 4 0 0 0 -3 -3.85"/>',
  user: '<path d="M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0"/><path d="M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2"/>',
  x: '<path d="M18 6l-12 12"/><path d="M6 6l12 12"/>',
  check: '<path d="M5 12l5 5l10 -10"/>',
  circleCheck: '<path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0"/><path d="M9 12l2 2l4 -4"/>',
  bolt: '<path d="M13 3l0 7l6 0l-8 11l0 -7l-6 0l8 -11"/>',
};

const VERDICT_ICONS = {
  approved: { icon: 'circleCheck', cls: 'ok', title: 'Approved' },
  commented: { icon: 'message', cls: 'cm', title: 'Commented' },
  changes_requested: { icon: 'octagon', cls: 'cr', title: 'Changes requested' },
};

const PIPE_TITLES = {
  running: 'Pipeline running',
  failed: 'Pipeline failed',
  passed: 'Pipeline passed',
};

function pipeBadge(pipeline) {
  if (!PIPE_TITLES[pipeline]) return null;
  const badge = el('span', `pipe ${pipeline}`);
  if (pipeline === 'failed') badge.append(icon('x', 9));
  if (pipeline === 'passed') badge.append(icon('check', 8));
  badge.title = PIPE_TITLES[pipeline];
  return badge;
}

function icon(name, size = 15) {
  const span = el('span', 'icon');
  span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  return span;
}

function renderQueue(state) {
  const view = document.getElementById('view-queue');
  view.textContent = '';

  if (!state.settings) {
    const s = el('div', 'setup');
    s.append(el('div', '', 'Connect your GitLab to build your review queue.'));
    const b = el('button', '', 'Open settings');
    b.addEventListener('click', () => hasChrome && chrome.runtime.openOptionsPage());
    s.append(b);
    view.append(s);
    return;
  }

  if (state.queue.length) {
    const { asap, normal, nextKey } = partitionQueue(state.queue);

    if (asap.length) {
      const asapZone = el('div');
      appendItems(asapZone, asap, state, nextKey);
      view.append(asapZone);
    }
    if (normal.length) {
      const normalZone = el('div');
      appendItems(normalZone, normal, state, nextKey);
      view.append(normalZone);
    }
  } else {
    view.append(buildEmptyState(state));
  }

  renderWaiting(view, state);
  renderHidden(view, state.hidden || []);
}

function emptyBadge() {
  const span = el('span', 'empty-icon');
  span.innerHTML =
    '<svg width="60" height="60" viewBox="0 0 96 96" aria-hidden="true">' +
    '<circle cx="48" cy="48" r="46" class="es-bg"/>' +
    '<circle cx="48" cy="48" r="43" fill="none" class="es-line" stroke-width="5"/>' +
    '<circle cx="48" cy="48" r="27" fill="none" class="es-line" stroke-width="2.5" opacity="0.3"/>' +
    '<path d="M33 48 l11 11 l20 -22" fill="none" class="es-line" stroke-width="7" ' +
    'stroke-linecap="round" stroke-linejoin="round"/></svg>';
  return span;
}

function buildEmptyState(state) {
  const waiting = state.waiting || [];
  const box = el('div', 'empty');
  box.append(emptyBadge());

  if (waiting.length) {
    const one = waiting.length === 1;
    box.append(el('div', 'empty-title', 'Queue is clear'));
    box.append(
      el(
        'div',
        'empty-sub',
        `${waiting.length} merge request${one ? '' : 's'} ${one ? 'is' : 'are'} waiting on ${
          one ? 'its author' : 'their authors'
        }.`
      )
    );
    return box;
  }

  box.append(el('div', 'empty-title', 'All clear'));
  box.append(el('div', 'empty-sub', 'No merge requests need your review.'));
  const today = computeStats(state.history || []).today;
  if (today > 0) {
    box.append(el('div', 'empty-done', `${today} review${today === 1 ? '' : 's'} done today`));
  }
  return box;
}

const MAX_LABELS = 2;
const expandedLabels = new Set();

function labelChips(item, state) {
  const colors = (state.labelColors || {})[item.projectId] || {};
  const wrap = el('span', 'chips');
  if (item.viaGroup) {
    const group = el('span', 'chip-group');
    group.append(icon('users', 10), el('span', '', 'group'));
    group.title = 'In your queue via a group approval rule';
    wrap.append(group);
  }
  const asapLabel = (state.settings && state.settings.asapLabel) || 'asap';
  const labels = sortLabels(item.labels, asapLabel);
  const expanded = expandedLabels.has(item.key);
  const shown = expanded ? labels : labels.slice(0, MAX_LABELS);
  for (const name of shown) {
    const chip = el('span', 'chip-label', name);
    const color = colors[name];
    if (color && /^#[0-9a-f]{3,8}$/i.test(color)) {
      chip.style.background = color;
      chip.style.color = labelTextColor(color);
    }
    wrap.append(chip);
  }
  if (labels.length > MAX_LABELS) {
    const toggle = el('button', 'chip-label more', expanded ? 'less' : `+${labels.length - MAX_LABELS}`);
    toggle.title = expanded ? 'Collapse labels' : labels.slice(MAX_LABELS).join(', ');
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      if (expanded) expandedLabels.delete(item.key);
      else expandedLabels.add(item.key);
      refresh();
    });
    wrap.append(toggle);
  }
  return wrap;
}

function appendItems(zone, items, state, nextKey) {
  for (const item of items) {
    const li = el('div', 'item');
    if (item.key === nextKey) li.classList.add('next');
    li.draggable = true;
    li.dataset.key = item.key;

    const rail = el('div', 'rail');
    const grip = el('span', 'grip');
    grip.append(icon('grip', 13));
    rail.append(grip, el('span', 'stripe'));

    const body = el('div', 'body');

    const top = el('div', 'item-top');
    if (item.asap) {
      const bolt = el('span', 'bolt');
      bolt.append(icon('bolt', 14));
      bolt.title = 'Urgent';
      top.append(bolt);
    }
    top.append(labelChips(item, state));
    const pipe = pipeBadge(item.pipeline);
    if (pipe) top.append(pipe);
    const hide = el('button', 'act hide');
    hide.append(icon('eyeOff'));
    hide.title = 'Hide';
    hide.addEventListener('click', () => send({ type: 'HIDE', key: item.key }).then(refresh));
    top.append(hide);

    const title = el('a', 'item-title', item.title);
    title.href = safeUrl(item.webUrl);
    title.target = '_blank';
    title.rel = 'noreferrer';
    title.title = item.title;

    const meta = buildMeta(item);
    appendAge(meta, item.requestedAt || item.createdAt, item.createdAt);
    body.append(top, title, meta);

    const row = el('div', 'card-row');
    row.append(rail, body);
    if (item.key === nextKey) {
      li.append(el('div', 'eyebrow', 'Up next'), row);
    } else {
      li.append(row);
    }
    wireDrag(li, zone);
    zone.append(li);
  }
  zone.addEventListener('dragover', (e) => {
    if (zone.querySelector('.dragging')) e.preventDefault();
  });
}

function buildMeta(item) {
  const meta = el('div', 'item-meta');
  const author = el('span', 'meta-author');
  author.append(icon('user', 11), el('span', 'name', shortName(item.author)));
  author.title = item.author;
  const path = el('span', 'meta-text', `${shortPath(item.projectPath)}!${item.iid}`);
  path.title = `${item.projectPath}!${item.iid}`;
  meta.append(author, path);
  return meta;
}

function appendAge(node, ts, openedAt) {
  if (!ts) return;
  const fmt = (t) =>
    new Date(t).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  const age = el('span', 'item-age', ageText(ts));
  age.title =
    openedAt && openedAt !== ts
      ? `In review since ${fmt(ts)} · opened ${fmt(openedAt)}`
      : `Opened ${fmt(ts)}`;
  node.append(age);
}

let dragActive = false;
let refreshQueued = false;
let dragStartOrder = '';

function wireDrag(li, wrap) {
  li.addEventListener('dragstart', (e) => {
    dragActive = true;
    dragStartOrder = [...wrap.querySelectorAll('.item')].map((n) => n.dataset.key).join(',');
    li.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  li.addEventListener('dragend', (e) => {
    li.classList.remove('dragging');
    dragActive = false;
    const orderedKeys = [...wrap.querySelectorAll('.item')].map((n) => n.dataset.key);
    const cancelled = e.dataTransfer && e.dataTransfer.dropEffect === 'none';
    const changed = orderedKeys.join(',') !== dragStartOrder;
    const finish = () => {
      if (refreshQueued) {
        refreshQueued = false;
        refresh();
      }
    };
    if (!cancelled && changed) {
      send({ type: 'REORDER', orderedKeys }).then(refresh).then(finish);
    } else {
      refresh().then(finish);
    }
  });
  li.addEventListener('dragover', (e) => {
    const dragging = wrap.querySelector('.dragging');
    if (!dragging) return;
    e.preventDefault();
    if (dragging === li) return;
    const rect = li.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    wrap.insertBefore(dragging, before ? li : li.nextSibling);
  });
}

const WAITING_SECTIONS = {
  requested_changes: { label: 'Changes requested', cls: 'cr', icon: 'octagon' },
  reviewed: { label: 'Commented', cls: 'cm', icon: 'message' },
};

function renderWaiting(view, state) {
  const waiting = state.waiting || [];
  for (const [stateName, section] of Object.entries(WAITING_SECTIONS)) {
    const items = waiting.filter((w) => w.state === stateName);
    if (!items.length) continue;

    const divider = el('div', `divider ${section.cls}`);
    divider.append(icon(section.icon, 13));
    divider.append(el('span', '', `${section.label} · ${items.length}`));
    view.append(divider);

    for (const item of items) {
      const row = el('div', `item ${section.cls}`);

      const rail = el('div', 'rail');
      rail.append(el('span', 'stripe'));

      const body = el('div', 'body');

      const top = el('div', 'item-top');
      top.append(labelChips(item, state));
      const hide = el('button', 'act hide');
      hide.append(icon('eyeOff'));
      hide.title = 'Hide';
      hide.addEventListener('click', () => send({ type: 'HIDE', key: item.key }).then(refresh));
      top.append(hide);

      const title = el('a', 'item-title', item.title);
      title.href = safeUrl(item.webUrl);
      title.target = '_blank';
      title.rel = 'noreferrer';
      title.title = item.title;

      const meta = buildMeta(item);
      appendAge(meta, item.createdAt);
      body.append(top, title, meta);

      const inner = el('div', 'card-row');
      inner.append(rail, body);
      row.append(inner);
      view.append(row);
    }
  }
}

const HIDDEN_OPEN_KEY = 'rq-hidden-open';

function renderHidden(view, hidden) {
  if (!hidden.length) return;
  const isOpen = localStorage.getItem(HIDDEN_OPEN_KEY) === '1';

  const toggle = el('button', 'hidden-toggle');
  const chevron = icon('chevron', 13);
  chevron.classList.add('chevron');
  if (isOpen) chevron.classList.add('open');
  toggle.append(chevron, icon('eyeOff', 14), el('span', '', `Hidden · ${hidden.length}`));
  toggle.addEventListener('click', () => {
    localStorage.setItem(HIDDEN_OPEN_KEY, isOpen ? '0' : '1');
    refresh();
  });
  view.append(toggle);

  if (!isOpen) return;

  for (const item of hidden) {
    const row = el('div', 'item hiddenrow');

    const rail = el('div', 'rail');
    rail.append(el('span', 'stripe'));

    const body = el('div', 'body');
    const top = el('div', 'item-top');
    const title = el('a', 'item-title', item.title);
    title.href = safeUrl(item.webUrl);
    title.target = '_blank';
    title.rel = 'noreferrer';
    title.title = item.title;
    title.style.flex = '1';
    const restore = el('button', 'act hide');
    restore.append(icon('eye'));
    restore.title = 'Return to queue';
    restore.addEventListener('click', () => send({ type: 'RESTORE', key: item.key }).then(refresh));
    top.append(title, restore);

    const meta = buildMeta(item);
    const hiddenAge = el('span', 'item-age', `hidden ${ageText(item.hiddenAt)} ago`);
    meta.append(hiddenAge);

    body.append(top, meta);
    const inner = el('div', 'card-row');
    inner.append(rail, body);
    row.append(inner);
    view.append(row);
  }
}

let recentShown = 10;

function renderStats(state) {
  const view = document.getElementById('view-stats');
  view.textContent = '';
  const h = state.history;

  const stats = computeStats(h);
  const weekDelta = stats.week - stats.prevWeek;
  const cards = [
    ['Today', stats.today, `yesterday: ${stats.yesterday}`],
    ['Week', stats.week, `${weekDelta > 0 ? '+' : weekDelta === 0 ? '±' : ''}${weekDelta} vs prev`],
    ['Month', stats.month, monthStartLabel()],
    ['All time', stats.total, ''],
  ];
  const grid = el('div', 'stat-grid');
  for (const [label, value, sub] of cards) {
    const card = el('div', 'stat-card');
    card.append(el('div', 'label', label), el('div', 'value', String(value)));
    const subEl = el('div', 'sub', sub || ' ');
    if (sub.startsWith('+')) subEl.classList.add('up');
    card.append(subEl);
    grid.append(card);
  }
  view.append(grid);

  const weeks = activityWeeks(h, 16);
  const header = el('div', 'stats-header');
  const legend = el('span', 'right legend');
  legend.append(el('span', '', 'less'));
  for (let i = 0; i <= 4; i++) {
    const sq = el('span', 'cell mini');
    if (i > 0) sq.classList.add(`l${i}`);
    legend.append(sq);
  }
  legend.append(el('span', '', 'more'));
  header.append(el('span', '', 'Activity'), legend);
  view.append(header);

  const ticks = monthTicks(weeks);
  const monthsRow = el('div', 'gh-months');
  monthsRow.append(el('span', '', ''));
  for (const tick of ticks) monthsRow.append(el('span', '', tick));
  view.append(monthsRow);

  const wrap = el('div', 'gh-wrap');
  const dayLabels = el('div', 'gh-labels');
  for (const name of ['Mon', '', 'Wed', '', 'Fri', '', 'Sun']) {
    dayLabels.append(el('span', '', name));
  }
  wrap.append(dayLabels);

  const gridEl = el('div', 'gh-grid');
  for (const week of weeks) {
    const col = el('div', 'gh-col');
    for (const day of week) {
      const cell = el('span', 'cell');
      if (day.level > 0) cell.classList.add(`l${day.level}`);
      if (day.level === -1) cell.classList.add('future');
      else cell.title = `${shortDate(day.dayStart)}: ${day.count} review${day.count === 1 ? '' : 's'}`;
      col.append(cell);
    }
    gridEl.append(col);
  }
  wrap.append(gridEl);
  view.append(wrap);

  const first = weeks[0][0].dayStart;
  const last = weeks[weeks.length - 1][6].dayStart;
  view.append(el('div', 'cal-range', `${shortDate(first)} — ${shortDate(last)}`));

  if (h.length) {
    const listHeader = el('div', 'stats-header');
    listHeader.append(
      el('span', '', 'Recent reviews'),
      el('span', 'right', `${Math.min(recentShown, h.length)} of ${h.length}`)
    );
    view.append(listHeader);

    for (const item of h.slice(0, recentShown)) {
      const row = el('div', 'recent-row');
      const verdict = VERDICT_ICONS[item.how];
      if (verdict) {
        const v = el('span', `verdict ${verdict.cls}`);
        v.append(icon(verdict.icon, 13));
        v.title = verdict.title;
        row.append(v);
      }
      const a = el('a', '', item.title);
      a.href = safeUrl(item.webUrl);
      a.target = '_blank';
      a.rel = 'noreferrer';
      row.append(a, el('span', 'when', whenText(item.completedAt)));
      view.append(row);
    }

    if (h.length > recentShown) {
      const more = el('button', 'show-more', `Show ${Math.min(10, h.length - recentShown)} more`);
      more.addEventListener('click', () => {
        recentShown += 10;
        refresh();
      });
      view.append(more);
    }
  } else {
    const e = el('div', 'empty');
    e.append(el('div', '', 'No completed reviews yet.'));
    view.append(e);
  }
}

function renderFooter(state) {
  const status = document.getElementById('sync-status');
  const syncBtn = document.getElementById('sync-now');
  const isSyncing =
    state.syncing && state.syncStartedAt && Date.now() - state.syncStartedAt < 120e3;

  syncBtn.classList.toggle('spinning', Boolean(isSyncing));

  if (isSyncing) {
    status.className = 'muted';
    status.textContent = 'Syncing…';
  } else if (state.lastError) {
    status.className = 'error';
    status.textContent = state.lastError;
  } else if (state.lastSync) {
    status.className = 'muted';
    status.textContent = `Synced ${ageText(state.lastSync)} ago`;
  } else {
    status.className = 'muted';
    status.textContent = state.settings ? 'Not synced yet' : 'Not connected to GitLab';
  }
  document.getElementById('queue-count').textContent = String(state.queue.length);

  const seenAt = state.logsSeenAt || 0;
  const freshErrors = (state.logs || []).some((l) => l.level === 'error' && l.ts > seenAt);
  document.getElementById('log-dot').classList.toggle('hidden', !freshErrors);
}

async function refresh() {
  if (dragActive) {
    refreshQueued = true;
    return;
  }
  const state = await loadState();
  renderQueue(state);
  renderStats(state);
  renderFooter(state);
}

function safeUrl(url) {
  return /^https?:\/\//i.test(url || '') ? url : '#';
}

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    document.getElementById('view-queue').classList.toggle('hidden', tab.dataset.tab !== 'queue');
    document.getElementById('view-stats').classList.toggle('hidden', tab.dataset.tab !== 'stats');
  });
});

document.getElementById('open-options').addEventListener('click', () => {
  if (hasChrome) chrome.runtime.openOptionsPage();
});

document.getElementById('open-logs').addEventListener('click', () => {
  if (hasChrome && chrome.tabs) {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/logs/logs.html') });
  } else {
    window.open('../logs/logs.html', '_blank');
  }
});

document.getElementById('sync-now').addEventListener('click', () => {
  const btn = document.getElementById('sync-now');
  btn.classList.add('spinning');
  document.getElementById('sync-status').textContent = 'Syncing…';
  send({ type: 'SYNC_NOW' }).then(refresh);
});

if (hasChrome) {
  chrome.storage.onChanged.addListener(refresh);
  send({ type: 'SYNC_NOW' }).then(refresh).catch(() => {});
}
if (hasChrome && chrome.runtime && chrome.runtime.getManifest) {
  document.getElementById('about-version').textContent =
    `v${chrome.runtime.getManifest().version}`;
}
refresh();
