const $ = (id) => document.getElementById(id);
const hasChrome = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;

function setStatus(text, cls) {
  const s = $('status');
  s.textContent = text;
  s.className = cls || '';
}

function setChip(text, cls) {
  const chip = $('conn-chip');
  chip.textContent = text;
  chip.className = `chip ${cls}`;
}

function setTokenMode(saved) {
  $('token-entry').classList.toggle('hidden', saved);
  $('token-saved').classList.toggle('hidden', !saved);
  if (saved) $('token').value = '';
}

function tokenPageUrl(rawUrl) {
  const clean = String(rawUrl || '').trim().replace(/\/+$/, '');
  if (!/^https:\/\//i.test(clean)) return null;
  try {
    const u = new URL(clean);
    const base = u.origin + u.pathname.replace(/\/+$/, '');
    return `${base}/-/user_settings/personal_access_tokens?name=Review%20Rail&scopes=read_api`;
  } catch {
    return null;
  }
}

function updateTokenLink() {
  const url = tokenPageUrl($('base-url').value);
  const link = $('token-link');
  const hint = $('token-link-hint');
  if (url) {
    link.href = url;
    link.classList.remove('hidden');
    hint.classList.add('hidden');
  } else {
    link.classList.add('hidden');
    hint.classList.remove('hidden');
  }
}

async function load() {
  if (!hasChrome) return;
  const { settings } = await chrome.storage.local.get('settings');
  if (settings) {
    $('base-url').value = settings.baseUrl || '';
    $('asap-label').value = settings.asapLabel || 'asap';
    if (settings.token) setChip(`Connected as @${settings.username}`, 'ok');
    else setChip('Not connected — no token', 'err');
    $('save').textContent = 'Save changes';
    setTokenMode(Boolean(settings.token));
  } else {
    $('asap-label').value = 'asap';
    setTokenMode(false);
  }
  updateTokenLink();
}

$('base-url').addEventListener('input', updateTokenLink);

$('show-token').addEventListener('change', (e) => {
  $('token').type = e.target.checked ? 'text' : 'password';
});

$('reset-token').addEventListener('click', async () => {
  if (hasChrome) await chrome.runtime.sendMessage({ type: 'RESET_TOKEN' });
  setTokenMode(false);
  setChip('Not connected — no token', 'err');
  setStatus('Token cleared — enter a new one and connect', '');
  $('save').textContent = 'Connect';
  $('token').focus();
});

function showSuccess(username) {
  setChip(`Connected as @${username}`, 'ok');
  setStatus('');
  setTokenMode(true);
  $('done-title').textContent = `Connected as @${username}`;
  $('done-panel').classList.remove('hidden');
  $('save').textContent = 'Save changes';
  $('done-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

$('close-tab').addEventListener('click', () => {
  if (hasChrome && chrome.tabs && chrome.tabs.getCurrent) {
    chrome.tabs.getCurrent((tab) => {
      if (tab && tab.id != null) chrome.tabs.remove(tab.id);
      else window.close();
    });
  } else {
    window.close();
  }
});

$('save').addEventListener('click', async () => {
  const baseUrl = $('base-url').value.trim().replace(/\/+$/, '');
  const tokenEntryVisible = !$('token-entry').classList.contains('hidden');
  const token = tokenEntryVisible ? $('token').value.trim() : '';
  const asapLabel = $('asap-label').value.trim() || 'asap';

  if (/^http:\/\//i.test(baseUrl)) {
    setStatus('http:// is not supported — the token would be sent unencrypted. Use https://', 'err');
    return;
  }
  if (!/^https:\/\//i.test(baseUrl)) {
    setStatus('Enter a URL like https://gitlab.example.com', 'err');
    return;
  }
  if (tokenEntryVisible && !token) {
    setStatus('Enter an access token', 'err');
    return;
  }
  if (!hasChrome) return;

  $('save').disabled = true;
  setStatus('Checking the connection…');
  try {
    const origin = new URL(baseUrl).origin;
    const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
    if (!granted) {
      setStatus('Access was declined — click Connect again and allow access to your GitLab host.', 'err');
      return;
    }
    const res = await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', baseUrl, token, asapLabel });
    if (res && res.ok) {
      showSuccess(res.username);
    } else {
      $('done-panel').classList.add('hidden');
      setStatus((res && res.error) || 'Connection failed', 'err');
      setChip('Connection error', 'err');
    }
  } catch (e) {
    setStatus(String(e.message || e), 'err');
  } finally {
    $('save').disabled = false;
  }
});

load();
updateTokenLink();

const aboutVersion = document.getElementById('about-version');
if (aboutVersion && typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) {
  aboutVersion.textContent = `Review Rail v${chrome.runtime.getManifest().version}`;
}
