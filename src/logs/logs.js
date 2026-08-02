const hasChrome = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;

function fmtTime(ts) {
  const d = new Date(ts);
  const time = d.toLocaleTimeString('en-GB', { hour12: false });
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  if (sameDay) return time;
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${time}`;
}

function entryText(e) {
  const lines = [
    `${fmtTime(e.ts)}  ${e.level === 'error' ? 'ERR' : 'INF'}  ${e.source}  ${e.message}` +
      (e.count > 1 ? `  (×${e.count})` : ''),
  ];
  if (e.detail) lines.push(`    ${e.detail}`);
  if (e.hint) lines.push(`    Hint: ${e.hint}`);
  return lines.join('\n');
}

let logs = [];

function render() {
  const errorsOnly = document.getElementById('errors-only').checked;
  const list = document.getElementById('list');
  list.textContent = '';
  const shown = errorsOnly ? logs.filter((e) => e.level === 'error') : logs;

  const errCount = logs.filter((e) => e.level === 'error').length;
  const badge = document.getElementById('err-badge');
  badge.hidden = errCount === 0;
  badge.textContent = `${errCount} error${errCount === 1 ? '' : 's'}`;

  if (!shown.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = errorsOnly ? 'No errors logged.' : 'Nothing logged yet.';
    list.append(empty);
    return;
  }

  for (const e of shown) {
    const row = document.createElement('div');
    row.className = `row ${e.level}`;

    const line = document.createElement('div');
    line.className = 'line';
    const mk = (cls, text) => {
      const s = document.createElement('span');
      s.className = cls;
      s.textContent = text;
      return s;
    };
    line.append(
      mk('ts', fmtTime(e.ts)),
      mk(`lvl ${e.level}`, e.level === 'error' ? 'ERR' : 'INF'),
      mk('src', e.source),
      mk('msg', e.message)
    );
    if (e.count > 1) line.append(mk('count', `×${e.count}`));
    row.append(line);

    if (e.detail) {
      const d = document.createElement('div');
      d.className = 'detail';
      d.textContent = e.detail;
      row.append(d);
    }
    if (e.hint) {
      const h = document.createElement('div');
      h.className = 'hint';
      h.textContent = `Hint: ${e.hint}`;
      row.append(h);
    }
    list.append(row);
  }
}

async function load() {
  if (!hasChrome) {
    logs = [
      { ts: Date.now() - 60e3, level: 'error', source: 'api', message: 'GET /projects/:id/merge_requests/:id/approvals → 403', detail: '/projects/42/merge_requests/581/approvals · GitLab says: "insufficient_scope"', hint: 'Access denied — the token may lack the read_api scope or project access', count: 3 },
      { ts: Date.now() - 61e3, level: 'error', source: 'sync', message: 'Sync stopped at step "check queue items"', detail: 'GitLab API 403: /projects/42/merge_requests/581/approvals', count: 1 },
      { ts: Date.now() - 5 * 60e3, level: 'info', source: 'sync', message: 'Synced in 1.2 s · 6 MRs checked · 1 added · 1 completed', count: 1 },
    ];
    render();
    return;
  }
  const { logs: stored = [] } = await chrome.storage.local.get('logs');
  logs = stored;
  await chrome.storage.local.set({ logsSeenAt: Date.now() });
  render();
}

document.getElementById('errors-only').addEventListener('change', render);

document.getElementById('copy').addEventListener('click', async () => {
  await navigator.clipboard.writeText(logs.map(entryText).join('\n'));
});

document.getElementById('clear').addEventListener('click', async () => {
  logs = [];
  if (hasChrome) await chrome.runtime.sendMessage({ type: 'CLEAR_LOGS' });
  render();
});

if (hasChrome) {
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.logs) {
      logs = changes.logs.newValue || [];
      render();
    }
  });
}

load();
