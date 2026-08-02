import { pushLog } from '../lib/log.js';

export const HISTORY_LIMIT = 5000;

export async function getState() {
  return chrome.storage.local.get({
    settings: null,
    queue: [],
    history: [],
    waiting: [],
    hidden: [],
    snoozed: {},
    labelColors: {},
    labelColorsAt: {},
    logs: [],
    logsSeenAt: null,
    lastSync: null,
    lastError: null,
    backfillDoneAt: null,
    syncing: false,
    syncStartedAt: null,
  });
}

export async function updateBadge() {
  const { queue } = await getState();
  await chrome.action.setBadgeBackgroundColor({ color: '#4F46E5' });
  await chrome.action.setBadgeText({ text: queue.length ? String(queue.length) : '' });
}

let logChain = Promise.resolve();

export function log(entry) {
  logChain = logChain
    .then(async () => {
      const { logs = [] } = await chrome.storage.local.get('logs');
      await chrome.storage.local.set({ logs: pushLog(logs, entry) });
    })
    .catch(() => {});
  return logChain;
}

export function clearLogs() {
  logChain = logChain
    .then(() => chrome.storage.local.set({ logs: [], logsSeenAt: Date.now() }))
    .catch(() => {});
  return logChain;
}

let writeChain = Promise.resolve();

export function enqueueWrite(fn) {
  const run = writeChain.then(fn);
  writeChain = run.catch(() => {});
  return run;
}

export function logInfo(source, message) {
  return log({ ts: Date.now(), level: 'info', source, message, count: 1 });
}

export function logError(source, message, detail, hint) {
  return log({ ts: Date.now(), level: 'error', source, message, detail, hint, count: 1 });
}
