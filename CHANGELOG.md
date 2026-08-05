# Changelog

All notable changes to Review Rail are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions match
Chrome Web Store releases.

## 0.2.2 - 2026-08-05

### Fixed

- Cards now disappear when you are unassigned as reviewer, and such reviews
  are not counted. A failed API call never removes a card.
- Pipeline status is no longer lost after a failed poll; cards with an
  unknown status are re-polled every sync until it resolves.

## 0.2.1 - 2026-08-04

### Changed

- HTTPS-only: plain-http GitLab hosts are no longer accepted.
- Card age counts from the moment you were asked to review and resets when
  review is re-requested after changes.
- Long author names and project paths are shortened in the card meta line;
  full values stay in the tooltip.

### Fixed

- Drag-and-drop no longer snaps the card back to its old position.
- "Request changes" verdicts are caught even when GitLab doesn't bump the
  MR's `updated_at`.
- Label colors now appear for labels created after the first sync.
- The refresh spinner spins the way its arrows point.

## 0.2.0 - 2026-08-02

Initial release: automatic queue from your reviewer assignments, urgency
labels, drag reordering, hide/restore, waiting sections, review stats with
an activity grid, history backfilled from GitLab.
