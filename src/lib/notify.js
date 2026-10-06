import { shortPath } from './queue.js';

const ID_PREFIX = 'rr:';
const LIST_LIMIT = 3;

// One notification per sync. The id carries the URL a click opens: a single
// MR links to itself, several link to the GitLab list of reviews.
export function notificationFor(items, { baseUrl, username }) {
  if (!items.length) return null;
  const sorted = [...items].sort((a, b) => Number(b.asap) - Number(a.asap));
  if (sorted.length === 1) {
    const [item] = sorted;
    let title = 'Review requested';
    if (item.asap) title = 'Urgent review requested';
    else if (item.reReview) title = 'Review requested again';
    return {
      id: ID_PREFIX + item.webUrl,
      title,
      message: item.title,
      contextMessage: `${shortPath(item.projectPath)}!${item.iid} · ${item.author}`,
    };
  }
  const urgent = sorted.filter((i) => i.asap).length;
  const lines = sorted.slice(0, LIST_LIMIT).map((i) => i.title);
  if (sorted.length > LIST_LIMIT) lines.push(`and ${sorted.length - LIST_LIMIT} more`);
  return {
    id: `${ID_PREFIX}${baseUrl}/dashboard/merge_requests?reviewer_username=${encodeURIComponent(username)}`,
    title: `${sorted.length} new reviews` + (urgent ? `, ${urgent} urgent` : ''),
    message: lines.join('\n'),
    contextMessage: 'Opens your review list in GitLab',
  };
}

// Opens only URLs on the configured GitLab origin.
export function notificationUrl(id, baseUrl) {
  if (typeof id !== 'string' || !id.startsWith(ID_PREFIX)) return null;
  const url = id.slice(ID_PREFIX.length);
  try {
    return new URL(url).origin === new URL(baseUrl).origin ? url : null;
  } catch {
    return null;
  }
}
