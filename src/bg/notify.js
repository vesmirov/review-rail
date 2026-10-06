import { notificationFor, notificationUrl } from '../lib/notify.js';
import { logError } from './store.js';

// Optional permission: notifications are on exactly while it is granted.
export const NOTIFY_PERMISSION = { permissions: ['notifications'] };

export async function notifyNewReviews(items, settings) {
  if (!items.length) return;
  try {
    if (!(await chrome.permissions.contains(NOTIFY_PERMISSION)) || !chrome.notifications) return;
    const n = notificationFor(items, settings);
    await chrome.notifications.create(n.id, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: n.title,
      message: n.message,
      contextMessage: n.contextMessage,
    });
  } catch (e) {
    logError('notify', 'Could not show a notification', String((e && e.message) || e));
  }
}

export async function openFromNotification(id) {
  const { settings } = await chrome.storage.local.get('settings');
  const url = settings && notificationUrl(id, settings.baseUrl);
  chrome.notifications.clear(id);
  if (url) await chrome.tabs.create({ url });
}
