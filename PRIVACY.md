# Privacy Policy — Review Rail

Last updated: July 31, 2026

Review Rail is a browser extension that maintains a personal code-review
queue for GitLab.

## What data the extension handles

- **GitLab personal access token** — entered by you, stored only in your
  browser's local extension storage (`chrome.storage.local`). It is sent
  exclusively to the GitLab server whose URL you configure, as an
  authentication header for API requests. It is never displayed after saving
  and never transmitted anywhere else.
- **Merge request metadata** (titles, authors, labels, timestamps, review
  states) and **your review history** — fetched from your GitLab server and
  stored locally in your browser to render the queue and statistics.
- **Diagnostic logs** — kept locally (last 300 entries). They contain API
  endpoint paths (with numeric project and MR ids), HTTP statuses, GitLab
  error messages, and the GitLab host you configured; never your token,
  merge request titles, or usernames.

## What the extension does NOT do

- No data is sent to the extension's developers or to any third party.
- No analytics, telemetry, tracking, or advertising of any kind.
- No data is sold or shared.
- The extension only communicates with the single GitLab host you explicitly
  configure and grant permission for.

## Transport

The token is sent only over the connection you configure. If you enter an
`http://` URL (some intranet instances), the token travels unencrypted over
that network — the settings page warns about this.

## Data removal

All data lives in your browser. Removing the extension deletes everything it
stored. You can also clear the token at any time with the "Reset token"
button in the extension settings.

## Contact

Questions about this policy: open an issue at
https://github.com/vesmirov/review-rail/issues.
