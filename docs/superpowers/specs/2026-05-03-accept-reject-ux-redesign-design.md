# Accept/Reject UX redesign — design spec

Tracks GitHub issue [#23](https://github.com/FilippoTonci/sanctum-desktop/issues/23).

## Goal

Replace the floating tooltip that today hovers above each focused
detection with a doc-first, sidebar-driven flow. The document should
read like a manuscript with margin annotations; per-detection actions
should always live in the same place (the right sidebar) so the user's
eye and mouse aren't darting between the doc and a moving popover.

## User-visible behaviour

The review surface keeps its two-pane layout (document on the left,
detections sidebar on the right). Inside that frame, four detection
states render distinctly:

| State              | Highlight (existing names)                              | Inline preview                                                                                                        |
| ------------------ | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Pending, unfocused | `sanctum-pending` (saffron dotted)                      | replacement floats just after the range in **muted oxblood italic mono**, opacity ≈ 0.55                              |
| Pending, focused   | `sanctum-pending` + `sanctum-focused` (oxblood outline) | original is **struck-through and faded** via new `previewing` registry; replacement renders firmly after, italic mono |
| Accepted           | `sanctum-accepted` (verdigris underline)                | original is **struck-through and faded** via `previewing`; replacement renders firmly after, italic mono              |
| Rejected           | `sanctum-rejected` (background only — see change below) | nothing rendered after the range — the original stands verbatim                                                       |

Notes on the table:

- The existing `sanctum-rejected` highlight applies `text-decoration:
line-through`. That conflicts with the new model — rejected means
  "keep this original text", so striking it out reads wrong. The
  redesign **removes the line-through from `::highlight(sanctum-rejected)`**
  and keeps only the muted background. This is a small, intentional
  visual change captured in the spec rather than smuggled in.
- "Faint" and "firm" preview styles share a single template; only
  opacity / colour differ. Same DOM element, different class
  (`inline-preview` vs `inline-preview-firm`).
- Pending-focused and accepted look almost identical at the preview
  layer. The differentiator is the highlight (oxblood-outline vs.
  verdigris). The visual continuity is intentional — the user has
  just made the decision; the small movement reduces the "did my click
  register?" gap.
- "Original gone" was considered for accepted but rejected. Hiding text
  rendered by `docx-preview` would mean post-render DOM mutation that
  could break inline layout (e.g. word-spacing across hidden runs).
  Strikethrough + faded gives the same "this is the proposed
  replacement" read without touching the document tree.

The floating tooltip is **deleted**. The existing keyboard map (Enter
accept / Backspace reject / arrows next, wired in
`src/renderer/src/review/keyboard.ts`) continues to drive the flow.

### Sidebar — focused row inline-expand

The sidebar is still a flat list ordered by document position. The
focused row grows in place to reveal the controls that used to live in
the tooltip:

- Entity text + entity type + status (existing)
- Operator dropdown (replace, redact, mask, encrypt, hips, pseudonymize)
- "Edit replacement…" button → opens an inline text input + Cancel
  inside the same expanded row (replacing the dropdown area, like the
  tooltip's edit mode does today)
- Accept (oxblood, ↵) / Reject (outline, ⌫) — primary actions

Non-focused rows render exactly as today: name, entity type, status
pill. Compact, scannable.

## Architecture

### Removed

- `src/renderer/src/components/DetectionTooltip.tsx` — entire file. The
  floating tooltip is gone; its capabilities move to the sidebar.
- `src/renderer/src/components/PreviewOverlay.tsx` — entire file. Its
  job (rendering ghost-text bubbles next to accepted detections) is
  absorbed into a new component that handles every relevant state, not
  just accepted.
- `index.css` blocks: `.detection-tooltip-*`, `.preview-bubble-*` and
  related class rules. Roughly ~120 lines.

### New

- `src/renderer/src/components/InlinePreview.tsx` — replaces
  `PreviewOverlay`. Same anchoring strategy (floating-ui virtual
  reference against the docx range), but renders for **every detection
  with a preview**, with the per-state class controlling appearance.
  The component reads `previews` and `detections` from the review store
  and emits one positioned span per visible row.

### Changed

- `src/renderer/src/components/DetectionSidebar.tsx`:
  - The focused detection's `<li>` renders an additional controls block
    (operator select, Edit-replacement button or text input, Accept /
    Reject buttons). All of these wire to the existing
    `useReviewActions()` hooks — no new actions needed.
  - State for "is the focused detection in edit-replacement mode?"
    moves from the deleted tooltip to the sidebar component. The
    `editingReplacementId` slice in the review store is reused as-is.

- `src/renderer/src/review/highlights.ts`:
  - Add a fifth registry, `sanctum-previewing`, that receives ranges
    for detections whose original text should be **struck-through**:
    `status === 'accepted'` OR `(status === 'pending' && id === focusedId)`.
  - The existing four registries (pending / accepted / rejected /
    focused) keep their roles.
  - `applyHighlightRegistries` keeps the same `(resolved, focusedId)`
    signature; the new logic is one extra branch.

- `src/renderer/src/index.css`:
  - Remove tooltip + preview-bubble CSS.
  - Add `::highlight(sanctum-previewing)` rule with strikethrough + faded ink.
  - Remove `text-decoration: line-through` from
    `::highlight(sanctum-rejected)` (background stays).
  - Add `.detection-sidebar-item-controls` and friends for the expanded
    focused row (operator select, edit button, accept/reject pair).
  - Add `.inline-preview` (faint default) and
    `.inline-preview-firm` (focused / accepted) classes.

- `src/renderer/src/components/ReviewSurface.tsx` (the parent that
  composes DocxView + sidebar): swap `<DetectionTooltip>` and
  `<PreviewOverlay>` for `<InlinePreview>`. Drop the `anchorRoot` plumb
  for the tooltip since it's gone.

## Data flow

No backend or store-shape changes. Everything the new UI needs already
exists:

- `useReviewStore.detections` — drives both sidebar list and inline
  previews.
- `useReviewStore.previews` — backend-computed preview text per
  detection ID, populated on every PATCH/POST that touches a decision
  (see `review/actions.ts::recordPreview`). The custom-replacement
  bypass is already handled by the backend; the renderer just reads
  whatever string is in this map.
- `useReviewStore.focusedId` — drives the sidebar expansion + the
  preview firm/faint class + the `previewing` highlight registry
  membership.
- `useReviewActions()` — `accept`, `reject`, `setOperator`,
  `setCustomReplacement` already exist; the sidebar wires to them
  directly.

When a detection has no preview yet (first paint, before the backend
roundtrip lands), `InlinePreview` skips it. That matches today's
behaviour for the floating bubble.

## Edge cases

- **Mapping store locked + pseudonymize selected** — today the tooltip
  shows a hint "Unlock the mapping store before committing." The
  expanded sidebar row reproduces the same hint under the operator
  dropdown using the existing `mappingStoreUnlocked` slice.
- **Custom replacement set** — the operator dropdown is disabled (today's
  behaviour, kept). The "Edit replacement…" button becomes "Replace
  with: <code>{value}</code> · Edit" matching today.
- **Detection range cannot be resolved against the docx DOM** — same
  fallback as today: nothing positioned, the sidebar still works.
  `resolveDetections` already filters unresolvable ranges.
- **Focus changes mid-edit** — switching focus while an "Edit
  replacement" input is open commits the current draft (or discards it
  on Escape). The Enter / Escape handlers currently inside
  `DetectionTooltip`'s edit-mode block are lifted verbatim into the
  sidebar component before `DetectionTooltip.tsx` is deleted.
- **Standalone fake mode** — no `previews` map is populated, so
  `InlinePreview` renders nothing; the highlight registries still work.
  Documented limitation, same as today's PreviewOverlay.

## Testing

Unit tests (Vitest, happy-dom):

- `DetectionSidebar.test.tsx` — focused row renders Operator + Edit +
  Accept/Reject; Accept fires `actions.accept(focusedId)`; Reject fires
  `actions.reject(focusedId)`; toggling Edit shows/hides the input;
  pressing Enter on the input commits via `setCustomReplacement`.
- `InlinePreview.test.tsx` — emits one positioned span per detection
  with a preview, with `inline-preview-firm` class iff focused or
  accepted; emits zero spans for rejected; emits zero spans when
  `previews[id]` is undefined.
- `highlights.test.ts` — expand the existing test to cover the new
  `sanctum-previewing` registry (membership for focused-pending and
  accepted, exclusion for rejected and unfocused-pending).

Manual:

- Spin up dev (`npm run dev`), open an existing OPEN session, walk
  through Accept / Reject / Edit replacement / operator change /
  pseudonymize-with-locked-store. Verify visual states match the
  table above and that no floating tooltip appears anywhere.

## Out of scope

- Animations on accept/reject ("replacement enters in place"). The
  state transitions are visually distinct enough on their own; motion
  can be added in a follow-up if it's still wanted.
- Preview-on-hover for non-focused rows. The faint inline preview is
  always on for pending; hover doesn't change anything.
- Sidebar search / filter / status grouping. Issue #23 is about the
  Accept/Reject interaction itself; list ergonomics are a separate
  conversation.

## Risk / open questions

- The faint italic-mono preview adds visible mid-line text on every
  pending detection. On documents with dense detections (≥10 per
  paragraph), this could read as cluttered. Mitigation: the faint style
  is calibrated to opacity 0.55 with a smaller mono font; if it's still
  too noisy after the implementation lands, we can pull back to
  focused-only without changing the architecture.
- `floating-ui`'s `autoUpdate` runs on scroll/resize. Going from one
  floating element (tooltip) plus N preview bubbles (accepted only) to
  one preview span per detection (potentially 30+) increases the
  per-frame work. Worth a smoke test on a document with many
  detections; if it costs noticeable time, we can switch to a single
  IntersectionObserver-driven layout pass instead of per-element
  `autoUpdate`.
