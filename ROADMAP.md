# Roadmap

Review Rail is an ordered review queue, not a dashboard: it answers
"what do I review next". Today that covers reviews waiting on you;
tracking your own merge requests waiting on others is on the list below.

## Working today

- Flat ordered queue with manual drag, urgency label support, and an
  always-highlighted "review this now" card
- Waiting sections (Changes requested / Commented) with automatic return
  to the queue when the author re-requests review
- Honest review counting from real GitLab actions only, with stats and a
  16-week activity grid
- Hide/restore with state tracking
- Pipeline status on cards — one icon: passed, failed, or running
- Group-approval MRs — merge requests where you are an eligible approver
  via a group rule are picked up and marked; silent on instances without
  approval rules (beta)
- GitLab: gitlab.com and self-hosted, read-only token (`read_api`)

## Next

Rough order. Subject to change.

1. **Working-hours age** — card age and staleness counted within your
   working hours, so Monday morning doesn't look like everything is on fire.
2. **Review WIP limit**: "no more than N reviews in flight". Extra cards
   collapse until you finish one; changes behavior, not just the view.
3. **Time to first response**: a personal metric for how long MRs wait
   for your first reaction, counted in working hours.
4. **Notifications** — new MRs entering your queue; status changes on
   your own MRs (approved, changes requested, commented, merged, failed
   pipeline).
5. **Your own MRs** — track their review status in the extension.
6. **GitHub support** (post-1.0) — same queue, same rules, pull requests.
   Not before the GitLab core has proven itself.
7. **Gamification**: milestones on top of the existing honest stats, and
   an opt-in peer leaderboard (top reviewers per day / week / month among
   colleagues you pick). No daily streaks: they reward showing up, not
   reviewing well. Leaderboards count only GitLab-verifiable actions
   (approvals read from each user's own events feed) because a fair
   competition needs numbers anyone can reproduce. The local activity
   ledger (re-review rounds, request-changes and comment verdicts) stays
   personal: GitLab keeps no queryable history of those, so they can be
   tracked for you but not verified for others. No backend either way:
   the leaderboard is computed by the extension with the same read-only
   token.

## Out of scope

These are deliberate decisions, not missing features.

- **Actions from the extension** (approve, merge, comment) — the
  extension is read-only, permanently.
- **Team dashboards and manager metrics** — the queue is personal. The
  planned peer leaderboard is not this: it is opt-in competition between
  colleagues, not reporting for someone above them.
- **AI review** — plenty of other tools do this.
- **Backend, accounts, telemetry** — everything stays in the browser.
