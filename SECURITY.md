# Security

Review Rail is read-only by design: it stores a GitLab personal access
token with the single `read_api` scope in `chrome.storage.local` and
talks to exactly one host, the GitLab URL you configure. No backend, no
telemetry; diagnostic logs never contain the token, MR titles, or
usernames (see [PRIVACY.md](PRIVACY.md)).

## Reporting a vulnerability

Please do not open a public issue for security problems. Use GitHub's
private vulnerability reporting on this repository (Security tab >
Report a vulnerability) or email dev@vesmirov.com. Confirmed issues are
fixed in the next release, with credit if you want it.

## Permissions promise

- The token scope stays `read_api`: the extension will never ask for a
  write scope.
- Host access stays limited to the single GitLab origin you configure.
- The permission set will never grow without a major version bump that
  says so in plain words in the changelog.
