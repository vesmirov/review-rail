import { normalizeBaseUrl, connectErrorMessage } from './lib/gitlab.js';
import { reorderWithin, hideItem, restoreItem } from './lib/queue.js';
import { getState, updateBadge, logInfo, enqueueWrite, clearLogs } from './bg/store.js';
import { tapi } from './bg/api.js';
import { sync, recordPendingAction } from './bg/sync.js';

const SYNC_ALARM = 'rq-sync';
const SYNC_MINUTES = 5;

chrome.runtime.onInstalled.addListener(init);
chrome.runtime.onStartup.addListener(init);

chrome.alarms.get(SYNC_ALARM).then((alarm) => {
  if (!alarm) chrome.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_MINUTES });
});

async function init() {
  chrome.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_MINUTES });
  await updateBadge();
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_ALARM) sync().catch(() => {});
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg)
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
  return true;
});

async function handleMessage(msg) {
  switch (msg.type) {
    case 'SAVE_SETTINGS':
      return saveSettings(msg);
    case 'RESET_TOKEN':
      return resetToken();
    case 'SYNC_NOW':
      return sync();
    case 'HIDE':
      return hideFromQueue(msg.key);
    case 'RESTORE':
      return restoreToQueue(msg.key);
    case 'REORDER':
      return reorder(msg.orderedKeys);
    case 'CLEAR_LOGS':
      await clearLogs();
      return { ok: true };
    default:
      throw new Error(`Unknown message type: ${msg.type}`);
  }
}

async function saveSettings({ baseUrl, token, asapLabel }) {
  const cleanUrl = normalizeBaseUrl(baseUrl);
  if (!cleanUrl) throw new Error('Enter a URL like https://gitlab.example.com');

  const { settings: existing } = await chrome.storage.local.get('settings');
  const urlChanged = Boolean(existing && normalizeBaseUrl(existing.baseUrl) !== cleanUrl);

  const enteredToken = String(token || '').trim();
  if (urlChanged && !enteredToken) {
    throw new Error('The GitLab URL changed — enter a token issued by the new server');
  }
  const cleanToken = enteredToken || (existing && existing.token) || '';
  if (!cleanToken) throw new Error('Enter an access token');

  const candidate = {
    baseUrl: cleanUrl,
    token: cleanToken,
    asapLabel: String(asapLabel || 'asap').trim() || 'asap',
  };
  let user;
  try {
    user = await tapi(candidate, '/user');
  } catch (e) {
    throw new Error(connectErrorMessage(e, cleanUrl));
  }
  const settings = { ...candidate, userId: user.id, username: user.username };
  await enqueueWrite(async () => {
    if (urlChanged) {
      try {
        const oldOrigin = new URL(existing.baseUrl).origin;
        if (oldOrigin !== new URL(cleanUrl).origin) {
          await chrome.permissions.remove({ origins: [`${oldOrigin}/*`] });
        }
      } catch {}
      await chrome.storage.local.set({
        queue: [],
        hidden: [],
        waiting: [],
        history: [],
        snoozed: {},
        projectPaths: {},
        labelColors: {},
        labelColorsAt: {},
        backfillDoneAt: null,
        lastSync: null,
      });
      logInfo('settings', 'GitLab URL changed — queue, history, and caches were reset');
    }
    await chrome.storage.local.set({ settings, lastError: null });
  });
  chrome.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_MINUTES });
  logInfo('settings', `Connected to ${cleanUrl}`);
  await updateBadge();
  sync().catch(() => {});
  return { ok: true, username: user.username };
}

async function resetToken() {
  await enqueueWrite(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    if (settings) {
      await chrome.storage.local.set({
        settings: { ...settings, token: '' },
        lastError: 'Not connected — the token was reset',
      });
      logInfo('settings', 'Token was reset by the user');
    }
  });
  return { ok: true };
}

async function hideFromQueue(key) {
  recordPendingAction({ type: 'hide', key, ts: Date.now() });
  await enqueueWrite(async () => {
    const { queue, hidden, waiting } = await getState();
    const next = hideItem({ queue, hidden, waiting }, key);
    await chrome.storage.local.set({
      queue: next.queue,
      hidden: next.hidden,
      waiting: next.waiting,
    });
  });
  await updateBadge();
  return { ok: true };
}

async function restoreToQueue(key) {
  recordPendingAction({ type: 'restore', key, ts: Date.now() });
  await enqueueWrite(async () => {
    const { queue, hidden, waiting } = await getState();
    const next = restoreItem({ queue, hidden, waiting }, key);
    await chrome.storage.local.set({
      queue: next.queue,
      hidden: next.hidden,
      waiting: next.waiting,
    });
  });
  await updateBadge();
  return { ok: true };
}

async function reorder(orderedKeys) {
  recordPendingAction({ type: 'reorder', orderedKeys });
  await enqueueWrite(async () => {
    const { queue } = await getState();
    await chrome.storage.local.set({ queue: reorderWithin(queue, orderedKeys) });
  });
  return { ok: true };
}
