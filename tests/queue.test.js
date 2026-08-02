import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mrKey,
  hasAsapLabel,
  queueItemFromMr,
  reorderWithin,
  partitionQueue,
  decideCompletion,
  reviewerVerdict,
  shouldAutoAdd,
  waitingState,
  resolveRequestedAt,
  hideItem,
  restoreItem,
  shouldUnhide,
  sortLabels,
  labelTextColor,
  refreshItemFromMr,
  pipelineIndicator,
  mergeReviewerAndApprover,
  applyQueueActions,
} from '../src/lib/queue.js';

const item = (key, asap = false) => ({ key, asap });

test('mrKey объединяет проект и iid', () => {
  assert.equal(mrKey(42, 7), '42:7');
});

test('hasAsapLabel: без учёта регистра, метка по умолчанию asap', () => {
  assert.equal(hasAsapLabel(['bug', 'ASAP']), true);
  assert.equal(hasAsapLabel(['bug']), false);
  assert.equal(hasAsapLabel([]), false);
  assert.equal(hasAsapLabel(undefined), false);
});

test('hasAsapLabel: настраиваемое имя метки', () => {
  assert.equal(hasAsapLabel(['priority::urgent'], 'priority::urgent'), true);
  assert.equal(hasAsapLabel(['asap'], 'priority::urgent'), false);
});

test('queueItemFromMr переносит поля MR, дату открытия, лейблы и asap-флаг', () => {
  const mr = {
    project_id: 5,
    iid: 12,
    title: 'Fix things',
    author: { name: 'Аня' },
    web_url: 'https://git.corp/team/app/-/merge_requests/12',
    labels: ['ASAP', 'backend'],
    created_at: '2026-07-01T10:00:00.000Z',
  };
  const it = queueItemFromMr(mr, { projectPath: 'team/app', asapLabel: 'asap', source: 'manual', now: 1000, requestedAt: 500 });
  assert.deepEqual(it, {
    key: '5:12',
    projectId: 5,
    iid: 12,
    title: 'Fix things',
    author: 'Аня',
    projectPath: 'team/app',
    webUrl: 'https://git.corp/team/app/-/merge_requests/12',
    addedAt: 1000,
    requestedAt: 500,
    createdAt: Date.parse('2026-07-01T10:00:00.000Z'),
    labels: ['ASAP', 'backend'],
    source: 'manual',
    asap: true,
  });
});

test('queueItemFromMr: без created_at подставляется now', () => {
  const mr = { project_id: 1, iid: 2, title: 't', author: null, web_url: 'x', labels: [] };
  const it = queueItemFromMr(mr, { projectPath: 'p', asapLabel: 'asap', source: 'auto', now: 42 });
  assert.equal(it.createdAt, 42);
});

test('refreshItemFromMr: дозаполняет дату открытия у старых карточек без createdAt', () => {
  const item = { key: '5:12', title: 'old', labels: [], asap: false };
  refreshItemFromMr(item, {
    title: 'new title',
    labels: ['ASAP', 'backend'],
    created_at: '2026-07-20T08:00:00.000Z',
  }, 'asap');
  assert.equal(item.title, 'new title');
  assert.equal(item.createdAt, Date.parse('2026-07-20T08:00:00.000Z'));
  assert.deepEqual(item.labels, ['ASAP', 'backend']);
  assert.equal(item.asap, true);
});

test('refreshItemFromMr: без created_at в ответе дата не трогается', () => {
  const item = { key: '5:12', title: 'old', labels: [], asap: false, createdAt: 123 };
  refreshItemFromMr(item, { title: 't', labels: [] }, 'asap');
  assert.equal(item.createdAt, 123);
});

test('labelTextColor: тёмный текст на светлом фоне, светлый — на тёмном', () => {
  assert.equal(labelTextColor('#ffffff'), '#1f2124');
  assert.equal(labelTextColor('#f5d90a'), '#1f2124');
  assert.equal(labelTextColor('#dc3545'), '#ffffff');
  assert.equal(labelTextColor('#1f2124'), '#ffffff');
  assert.equal(labelTextColor('garbage'), '#ffffff');
});

test('drag без срочных: любая карточка становится первой в списке', () => {
  const q = [
    { key: 'a', asap: false },
    { key: 'b', asap: false },
    { key: 'c', asap: false },
  ];
  const reordered = reorderWithin(q, ['c', 'a', 'b']);
  const { normal, nextKey } = partitionQueue(reordered);
  assert.equal(nextKey, 'c');
  assert.deepEqual(normal.map((i) => i.key), ['c', 'a', 'b']);
});

test('drag при срочных: asap меняются приоритетом между собой, обычные не двигаются', () => {
  const q = [
    { key: 'n1', asap: false },
    { key: 'a1', asap: true },
    { key: 'n2', asap: false },
    { key: 'a2', asap: true },
  ];
  const reordered = reorderWithin(q, ['a2', 'a1']);
  const { asap, normal, nextKey } = partitionQueue(reordered);
  assert.equal(nextKey, 'a2');
  assert.deepEqual(asap.map((i) => i.key), ['a2', 'a1']);
  assert.deepEqual(normal.map((i) => i.key), ['n1', 'n2']);
  assert.deepEqual(reordered.map((i) => i.key), ['n1', 'a2', 'n2', 'a1']);
});

test('drag обычных под срочными: первым остаётся asap', () => {
  const q = [
    { key: 'a1', asap: true },
    { key: 'n1', asap: false },
    { key: 'n2', asap: false },
  ];
  const reordered = reorderWithin(q, ['n2', 'n1']);
  const { normal, nextKey } = partitionQueue(reordered);
  assert.equal(nextKey, 'a1');
  assert.deepEqual(normal.map((i) => i.key), ['n2', 'n1']);
});

test('resolveRequestedAt: первая итерация — дата назначения ревьюером, повторная — момент возврата', () => {
  assert.equal(resolveRequestedAt({ isReReview: false, reviewerSince: 500, now: 1000 }), 500);
  assert.equal(resolveRequestedAt({ isReReview: true, reviewerSince: 500, now: 1000 }), 1000);
  assert.equal(resolveRequestedAt({ isReReview: false, reviewerSince: null, now: 1000 }), 1000);
});

test('reorderWithin: переставляет только перечисленные элементы, чужие позиции не трогает', () => {
  const q = [item('a'), item('b'), item('c'), item('d')];
  const next = reorderWithin(q, ['c', 'b']);
  assert.deepEqual(next.map((i) => i.key), ['a', 'c', 'b', 'd']);
});

test('reorderWithin: игнорирует устаревшие ключи', () => {
  const q = [item('a'), item('b')];
  const next = reorderWithin(q, ['b', 'gone', 'a']);
  assert.deepEqual(next.map((i) => i.key), ['b', 'a']);
});

test('reorderWithin: пустой список ключей ничего не меняет', () => {
  const q = [item('a'), item('b')];
  assert.deepEqual(reorderWithin(q, []).map((i) => i.key), ['a', 'b']);
});

test('partitionQueue: asap-блок первым, «следующее» — первый asap', () => {
  const q = [item('a'), item('b', true), item('c'), item('d', true)];
  const { asap, normal, nextKey } = partitionQueue(q);
  assert.deepEqual(asap.map((i) => i.key), ['b', 'd']);
  assert.deepEqual(normal.map((i) => i.key), ['a', 'c']);
  assert.equal(nextKey, 'b');
});

test('partitionQueue: без asap «следующее» — голова FIFO', () => {
  const { nextKey } = partitionQueue([item('a'), item('b')]);
  assert.equal(nextKey, 'a');
});

test('partitionQueue: пустая очередь', () => {
  assert.deepEqual(partitionQueue([]), { asap: [], normal: [], nextKey: null });
});

test('decideCompletion: аппрув засчитывается всегда', () => {
  assert.equal(decideCompletion({ state: 'opened', approvedByMe: true, commented: false }), 'approved');
  assert.equal(decideCompletion({ state: 'merged', approvedByMe: true, commented: true }), 'approved');
});

test('decideCompletion: влит/закрыт с комментариями — засчитан, без — удалён', () => {
  assert.equal(decideCompletion({ state: 'merged', approvedByMe: false, commented: true }), 'commented');
  assert.equal(decideCompletion({ state: 'closed', approvedByMe: false, commented: false }), 'drop');
});

test('decideCompletion: открытый MR без аппрува остаётся в очереди', () => {
  assert.equal(decideCompletion({ state: 'opened', approvedByMe: false, commented: true }), 'keep');
});

test('reviewerVerdict: request changes и submitted review засчитываются', () => {
  assert.equal(reviewerVerdict('requested_changes'), 'changes_requested');
  assert.equal(reviewerVerdict('reviewed'), 'commented');
});

test('reviewerVerdict: unreviewed, approved и неизвестные статусы — не зачёт', () => {
  assert.equal(reviewerVerdict('unreviewed'), null);
  assert.equal(reviewerVerdict('approved'), null);
  assert.equal(reviewerVerdict(null), null);
  assert.equal(reviewerVerdict('review_started'), null);
});

test('shouldAutoAdd: новый MR добавляется, уже стоящий в очереди — нет', () => {
  assert.equal(shouldAutoAdd({ inQueue: false, inHistory: false, reviewerState: null }), true);
  assert.equal(shouldAutoAdd({ inQueue: true, inHistory: false, reviewerState: null }), false);
});

test('shouldAutoAdd: после зачтённого ревью MR возвращается только при повторном запросе ревью', () => {
  assert.equal(shouldAutoAdd({ inQueue: false, inHistory: true, reviewerState: 'unreviewed' }), true);
  assert.equal(shouldAutoAdd({ inQueue: false, inHistory: true, reviewerState: 'requested_changes' }), false);
  assert.equal(shouldAutoAdd({ inQueue: false, inHistory: true, reviewerState: 'approved' }), false);
  assert.equal(shouldAutoAdd({ inQueue: false, inHistory: true, reviewerState: null }), false);
});

test('shouldAutoAdd: MR с уже отправленным ревью не попадает в очередь даже без истории', () => {
  assert.equal(shouldAutoAdd({ inQueue: false, inHistory: false, reviewerState: 'requested_changes' }), false);
  assert.equal(shouldAutoAdd({ inQueue: false, inHistory: false, reviewerState: 'reviewed' }), false);
  assert.equal(shouldAutoAdd({ inQueue: false, inHistory: false, reviewerState: 'approved' }), false);
  assert.equal(shouldAutoAdd({ inQueue: false, inHistory: false, reviewerState: 'unreviewed' }), true);
});

test('shouldAutoAdd: убранный вручную MR (snooze) не возвращается, пока висит в GitLab без ревью', () => {
  assert.equal(shouldAutoAdd({ inQueue: false, inHistory: false, reviewerState: 'unreviewed', isSnoozed: true }), false);
  assert.equal(shouldAutoAdd({ inQueue: false, inHistory: true, reviewerState: 'unreviewed', isSnoozed: true }), false);
  assert.equal(shouldAutoAdd({ inQueue: false, inHistory: false, reviewerState: null, isSnoozed: true }), false);
  assert.equal(shouldAutoAdd({ inQueue: false, inHistory: false, reviewerState: 'unreviewed', isSnoozed: false }), true);
});

test('hideItem: переносит MR из очереди в скрытые со штампом времени и состоянием', () => {
  const state = { queue: [{ key: 'a', title: 'A' }, { key: 'b', title: 'B' }], hidden: [], waiting: [] };
  const { queue, hidden } = hideItem(state, 'a', 777);
  assert.deepEqual(queue.map((i) => i.key), ['b']);
  assert.equal(hidden.length, 1);
  assert.equal(hidden[0].key, 'a');
  assert.equal(hidden[0].hiddenAt, 777);
  assert.equal(hidden[0].hiddenState, 'unreviewed');
});

test('hideItem: прячет карточку из раздела ожидания, запоминая её статус', () => {
  const state = {
    queue: [],
    hidden: [],
    waiting: [{ key: 'w', title: 'W', state: 'requested_changes' }],
  };
  const { hidden, waiting } = hideItem(state, 'w', 500);
  assert.deepEqual(waiting, []);
  assert.equal(hidden[0].hiddenState, 'requested_changes');
  assert.equal(hidden[0].hiddenAt, 500);
});

test('hideItem: неизвестный ключ — ничего не меняется', () => {
  const state = { queue: [{ key: 'a' }], hidden: [], waiting: [] };
  const { queue, hidden, waiting } = hideItem(state, 'nope', 1);
  assert.deepEqual(queue, state.queue);
  assert.deepEqual(hidden, []);
  assert.deepEqual(waiting, []);
});

test('restoreItem: спрятанный из очереди возвращается в очередь', () => {
  const state = {
    queue: [{ key: 'b' }],
    hidden: [{ key: 'a', title: 'A', requestedAt: 100, addedAt: 100, hiddenAt: 200, hiddenState: 'unreviewed' }],
    waiting: [],
  };
  const { queue, hidden, waiting } = restoreItem(state, 'a', 999);
  assert.deepEqual(queue.map((i) => i.key), ['b', 'a']);
  assert.equal(queue[1].addedAt, 999);
  assert.equal(queue[1].requestedAt, 100);
  assert.equal(queue[1].hiddenAt, undefined);
  assert.equal(queue[1].hiddenState, undefined);
  assert.deepEqual(hidden, []);
  assert.deepEqual(waiting, []);
});

test('restoreItem: спрятанный из ожидания возвращается в свой раздел, а не в очередь', () => {
  const state = {
    queue: [],
    hidden: [{ key: 'w', title: 'W', hiddenAt: 1, hiddenState: 'reviewed' }],
    waiting: [],
  };
  const { queue, hidden, waiting } = restoreItem(state, 'w', 999);
  assert.deepEqual(queue, []);
  assert.deepEqual(hidden, []);
  assert.equal(waiting.length, 1);
  assert.equal(waiting[0].state, 'reviewed');
  assert.equal(waiting[0].hiddenAt, undefined);
});

test('restoreItem: неизвестный ключ — ничего не меняется', () => {
  const state = { queue: [], hidden: [{ key: 'a', hiddenAt: 1 }], waiting: [] };
  const { queue, hidden } = restoreItem(state, 'nope');
  assert.deepEqual(queue, []);
  assert.deepEqual(hidden, state.hidden);
});

test('applyQueueActions: действия пользователя переигрываются поверх результата синка', () => {
  const state = {
    queue: [
      { key: 'a', title: 'A' },
      { key: 'b', title: 'B' },
      { key: 'c', title: 'C' },
    ],
    hidden: [{ key: 'z', title: 'Z', hiddenAt: 1, hiddenState: 'unreviewed' }],
    waiting: [],
  };
  const result = applyQueueActions(state, [
    { type: 'hide', key: 'b', ts: 100 },
    { type: 'restore', key: 'z', ts: 200 },
    { type: 'reorder', orderedKeys: ['c', 'a'] },
  ]);
  assert.deepEqual(result.queue.map((i) => i.key), ['c', 'a', 'z']);
  assert.deepEqual(result.hidden.map((i) => i.key), ['b']);
  assert.equal(result.hidden[0].hiddenAt, 100);
});

test('applyQueueActions: скрытие карточки ожидания переигрывается поверх синка', () => {
  const state = {
    queue: [{ key: 'a' }],
    hidden: [],
    waiting: [{ key: 'w', state: 'reviewed' }],
  };
  const result = applyQueueActions(state, [{ type: 'hide', key: 'w', ts: 50 }]);
  assert.deepEqual(result.waiting, []);
  assert.deepEqual(result.hidden.map((i) => i.key), ['w']);
  assert.equal(result.hidden[0].hiddenState, 'reviewed');
});

test('applyQueueActions: действия над исчезнувшими MR игнорируются', () => {
  const state = { queue: [{ key: 'a' }], hidden: [], waiting: [] };
  const result = applyQueueActions(state, [
    { type: 'hide', key: 'gone', ts: 1 },
    { type: 'restore', key: 'also-gone', ts: 2 },
  ]);
  assert.deepEqual(result.queue.map((i) => i.key), ['a']);
  assert.deepEqual(result.hidden, []);
});

test('shouldUnhide: возврат при изменении состояния относительно момента скрытия', () => {
  assert.equal(shouldUnhide('unreviewed', 'requested_changes'), true);
  assert.equal(shouldUnhide('approved', 'requested_changes'), true);
  assert.equal(shouldUnhide('requested_changes', 'requested_changes'), false);
  assert.equal(shouldUnhide('reviewed', 'reviewed'), false);
  assert.equal(shouldUnhide('requested_changes', 'unreviewed'), true);
  assert.equal(shouldUnhide('unreviewed', 'unreviewed'), false);
});

test('shouldUnhide: неизвестное текущее состояние не снимает скрытие', () => {
  assert.equal(shouldUnhide(null, 'requested_changes'), false);
  assert.equal(shouldUnhide(null, null), false);
});

test('shouldUnhide: старые записи без hiddenState считаются спрятанными из очереди', () => {
  assert.equal(shouldUnhide('requested_changes', undefined), true);
  assert.equal(shouldUnhide('unreviewed', undefined), false);
});

test('sortLabels: метка срочности всегда первая', () => {
  assert.deepEqual(sortLabels(['backend', 'config', 'asap'], 'asap'), ['asap', 'backend', 'config']);
  assert.deepEqual(sortLabels(['backend', 'ASAP'], 'asap'), ['ASAP', 'backend']);
  assert.deepEqual(sortLabels(['backend', 'priority::urgent'], 'priority::urgent'), [
    'priority::urgent',
    'backend',
  ]);
  assert.deepEqual(sortLabels(['backend', 'config'], 'asap'), ['backend', 'config']);
  assert.deepEqual(sortLabels([], 'asap'), []);
  assert.deepEqual(sortLabels(undefined, 'asap'), []);
});

test('waitingState: в блок ожидания попадают requested_changes и reviewed', () => {
  assert.equal(waitingState('requested_changes'), 'requested_changes');
  assert.equal(waitingState('reviewed'), 'reviewed');
  assert.equal(waitingState('approved'), null);
  assert.equal(waitingState('unreviewed'), null);
  assert.equal(waitingState(null), null);
});

test('pipelineIndicator: три состояния и отсутствие иконки', () => {
  assert.equal(pipelineIndicator('success'), 'passed');
  assert.equal(pipelineIndicator('failed'), 'failed');
  for (const s of ['created', 'waiting_for_resource', 'preparing', 'pending', 'running']) {
    assert.equal(pipelineIndicator(s), 'running', s);
  }
  for (const s of ['canceled', 'skipped', 'manual', 'scheduled', null, undefined, '', 'garbage']) {
    assert.equal(pipelineIndicator(s), null, String(s));
  }
});

test('mergeReviewerAndApprover: дедуп по ключу, ревьюерский список главнее', () => {
  const rev = [{ project_id: 1, iid: 10, author: { id: 2 } }];
  const app = [
    { project_id: 1, iid: 10, author: { id: 2 } },
    { project_id: 1, iid: 11, author: { id: 3 } },
  ];
  const extras = mergeReviewerAndApprover(rev, app, 658);
  assert.equal(extras.length, 1);
  assert.equal(extras[0].iid, 11);
});

test('mergeReviewerAndApprover: свои MR исключаются', () => {
  const app = [
    { project_id: 1, iid: 20, author: { id: 658 } },
    { project_id: 1, iid: 21, author: { id: 3 } },
    { project_id: 1, iid: 22, author: null },
  ];
  const extras = mergeReviewerAndApprover([], app, 658);
  assert.deepEqual(extras.map((m) => m.iid), [21, 22]);
});

test('mergeReviewerAndApprover: пустые и отсутствующие списки', () => {
  assert.deepEqual(mergeReviewerAndApprover([], [], 1), []);
  assert.deepEqual(mergeReviewerAndApprover([], undefined, 1), []);
  assert.deepEqual(mergeReviewerAndApprover([{ project_id: 1, iid: 1, author: null }], undefined, 1), []);
});

test('mergeReviewerAndApprover: дубликаты внутри approver-списка схлопываются', () => {
  const app = [
    { project_id: 1, iid: 30, author: { id: 3 } },
    { project_id: 1, iid: 30, author: { id: 3 } },
  ];
  assert.equal(mergeReviewerAndApprover([], app, 1).length, 1);
});

test('queueItemFromMr: viaGroup выставляется только когда передан', () => {
  const mr = { project_id: 1, iid: 2, title: 't', author: null, web_url: 'x', labels: [] };
  const plain = queueItemFromMr(mr, { projectPath: 'p', asapLabel: 'asap', source: 'auto', now: 1 });
  assert.equal('viaGroup' in plain, false);
  const grouped = queueItemFromMr(mr, { projectPath: 'p', asapLabel: 'asap', source: 'auto', now: 1, viaGroup: true });
  assert.equal(grouped.viaGroup, true);
});

test('refreshItemFromMr: не трогает viaGroup', () => {
  const item = { key: '1:2', title: 'old', labels: [], asap: false, viaGroup: true };
  refreshItemFromMr(item, { title: 'new', labels: [] }, 'asap');
  assert.equal(item.viaGroup, true);
});
