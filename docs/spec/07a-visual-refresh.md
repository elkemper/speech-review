# 07a — Visual refresh toward Photoshop/Audacity 3

[Index](../SPEC.md) · Parent: [07 — Layout](07-layout-history-visual.md) ·
Story 33

**Status:** Backlog · **Priority:** P2

This is a logically autonomous part of story 33. It is separated because it is
a broad visual redesign, not a functional bug fix.

## Story 33 (detail) — Professional desktop look

The current UI reads as a generic AI/chat product. The target is a professional
desktop tool from the 2010s–2020s: Photoshop, Audacity 3, a DAW or a video
editor.

### Direction

- Neutral dark greys, fewer blue/purple gradients and glows.
- Compact density: smaller radii, clear 1 px separators, toolbar-like headers.
- Monospace timecodes and numeric values.
- Clear selected/active/hover/disabled states.
- Defect colors remain the semantic signal; do not decorate randomly.
- Waveform and timeline read as an editor, not a card.
- Keep the Russian and English UI catalogues and dark-only theme.

### Non-goals

- No light theme.
- No new UI framework or icon library.
- No behaviour, data-model or IPC change.
- No loss of keyboard accessibility or contrast.

### Acceptance criteria

- [ ] No decorative gradient/glow remains without meaning.
- [ ] Corner radii and spacing are consistent across panels and dialogs.
- [ ] Toolbars, splitters and panel headers read as one system.
- [ ] Timecodes and numbers use the monospace stack.
- [ ] Active/hover/disabled/confirmed/skipped states are visually distinct.
- [ ] Defect colors and waveform remain readable at all zoom levels.
- [ ] Dark-only; no theme switcher.
- [ ] Keyboard focus is visible; contrast is checked.
- [ ] No functional or data-model changes.
- [ ] Screenshots are reviewed on macOS at 1280×800 and a larger display.

## Verification

- Visual review on macOS; not verifiable in this Linux container.
- Keep `test` green; this story should not change pure logic.