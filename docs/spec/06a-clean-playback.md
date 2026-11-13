# 06a — Clean playback without marked places

[Index](../SPEC.md) · Parent: [06 — Playback](06-playback.md) · Story 29

**Status:** Backlog / Decision needed · **Priority:** P2

This is a logically autonomous part of story 29. It is separated because it
changes the semantics of skipping and already overlaps with the current
"cut every non-dismissed item" review skip.

## Story 29 (detail) — Clean playback

As a user, I want to play the recording as if all marked places were cut out,
with controlled padding around each cut, without rendering a proxy or a new
file.

### Semantics

- Separate, explicitly named mode (for example "чистое прослушивание").
- It may skip **all selected defects/marks**, including unconfirmed ones.
- It must not change review skip (story 25): review skip already cuts every
  non-dismissed item.
- Implemented as seek-based playback over a cut list, like the current skip
  loop, not as a rendered proxy.
- Per-cut padding prevents words from gluing together.

### Conflicts / decision needed

Invariant 6 already makes review skip cut every non-dismissed item. A separate
mode is only needed if the scope must differ (for example including deleted
items, or changing padding independently). The spec must be updated with the
final mode name and exact scope before implementation.

### Acceptance criteria

- [ ] A separate mode is visible and named differently from fast-forward.
- [ ] It skips all places in the selected scope, including deleted ones if
      that is the approved scope.
- [ ] Per-cut padding is configurable and clamped.
- [ ] No proxy, transcode or new media file is created.
- [ ] Review skip behaviour is unchanged (invariant 6).
- [ ] The mode can be turned off without losing confirmation state or position.
- [ ] The UI shows what is being skipped.
- [ ] Playback recovers from seeking errors and never freezes.

### Out of scope

- Exporting a cut video.
- Changing the original media.
- Reusing the review-skip toggle with hidden semantics.

## Verification

- Product approval first.
- Pure cut-list/next-target logic must be unit-tested before UI work.