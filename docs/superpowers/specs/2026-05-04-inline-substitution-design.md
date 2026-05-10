# Inline substitution on accept — design spec

Follow-up to issue
[#23](https://github.com/FilippoTonci/sanctum-desktop/issues/23)
(Accept/Reject UX redesign), which shipped in
[PR #26](https://github.com/FilippoTonci/sanctum-desktop/pull/26).

## Problem

The shipped redesign anchors a `position: absolute` preview span just to
the right of each detection range and shows the proposed replacement on
top of the document. With `pointer-events: none` and `z-index: 25`, that
span literally sits on top of whatever document text follows the
detection. On a paragraph like

> The patient `John Smith` was admitted to ward 4B.

after Accept, the replacement `[PERSON_001]` floats over the words
"was admitted to ward". The decision _is_ recorded, but the document
stops being readable next to every accepted detection. User feedback:
"the implementation is better than before and feels less clunky but
the problem is that when accepting an edit, the preview goes on top of
the text right next to the edit — let's change that to something that
is clearer."

## Goal

Make the document pane reflect "what would actually be committed right
now". On accept, the replacement substitutes the original inline, with
the surrounding text reflowing around it — no overlay, no floating
span. Pending and rejected detections continue to show the original
text in place (highlighted), so the document only changes when a
decision actually changes it. The proposed replacement is always
visible in the sidebar so a reviewer can see what will happen before
they accept.

## User-visible behaviour

| State              | Document shows                                                    | Highlight (existing names)                                        | Sidebar row                                                                                          |
| ------------------ | ----------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Pending, unfocused | original verbatim                                                 | `sanctum-pending` (saffron dotted)                                | original + faint "→ replacement" hint                                                                |
| Pending, focused   | original verbatim                                                 | `sanctum-pending` + `sanctum-focused` (oxblood outline)           | original + replacement, expanded controls (operator / Edit / Accept / Reject) — unchanged from today |
| Accepted           | **replacement** (real inline text, reflows surrounding paragraph) | `sanctum-accepted` (verdigris underline) — paints the replacement | original + replacement (replacement firm)                                                            |
| Rejected           | original verbatim                                                 | `sanctum-rejected` (muted background only)                        | original + replacement (replacement greyed)                                                          |

Notes on the table:

- The document never contains a floating overlay. All visible text is
  in the document flow. "Substitution" means hiding the original text
  node and rendering a sibling span containing the replacement; the
  original survives in the DOM and re-shows on un-accept.
- The strikethrough-on-original treatment from the shipped design (the
  `sanctum-previewing` registry) is **removed**. Once accepted, the
  original simply stops being visible. While pending or rejected, the
  original is the only text shown — no strikethrough.
- The sidebar gains a "→ replacement" line under the existing original-text
  display on every row that has a preview available in
  `useReviewStore.previews`. This is the only place a reviewer sees the
  proposed replacement _before_ deciding, so it has to be there for
  every state, not just focused.
- For the rare case where a detection range crosses element boundaries
  (e.g., spans across a `<b>` and a plain run inside the docx), the
  wrap step is skipped for that detection. The highlight still paints,
  the sidebar still carries the replacement, and Accept still records
  the decision — only the in-document substitution is unavailable. See
  Edge cases below.

## Architecture

### Removed

- `src/renderer/src/components/InlinePreview.tsx` — the floating-ui
  positioned preview span. Replaced by inline-flow substitution.
- `src/renderer/src/index.css` — `.inline-preview` and
  `.inline-preview-firm` rules and their dark-mode siblings.
- `src/renderer/src/review/highlights.ts` — the `sanctum-previewing`
  registry name and its add-this-range branch.
- `src/renderer/src/index.css` — `::highlight(sanctum-previewing)`
  rule (strikethrough + faded ink).
- `tests/unit/renderer/inline-preview.test.ts` — entire file.
- The `previewing` membership assertions in
  `tests/unit/renderer/highlights.test.ts`.

### New

- `src/renderer/src/review/edit-wrap.ts` — DOM-mutation pass that wraps
  each resolved detection's `Range` in a
  `<span class="sanctum-edit" data-detection-id="…">` containing the
  original text node(s). Idempotent: on subsequent runs it skips
  detections that already have a wrap with the matching id, and
  unwraps any `.sanctum-edit` whose detection id is no longer in the
  resolved set. The wrap is structure-only — it does **not** set the
  `data-status` attribute. Exposes `wrapDetections(root, resolved)`
  and `unwrapAll(root)`.
- `src/renderer/src/components/EditReplacement.tsx` — React portal
  component. Reads `detections` and `previews` from the store, finds
  each `.sanctum-edit` wrapper in the docx body by
  `data-detection-id`, and (a) sets `data-status` on the wrapper to
  reflect the current detection status (only `accepted` when
  `previews[id]` is also present — otherwise the original keeps
  showing), and (b) portals a sibling
  `<span class="sanctum-edit-replacement">` containing the replacement
  text into each wrap that has a preview. The replacement DOM is
  always mounted when `previews[id]` exists; CSS handles whether it's
  visible. Owning both responsibilities in one component keeps wrap
  structure (a one-time concern) separate from per-state styling
  (a re-renders-with-the-store concern).

### Changed

- `src/renderer/src/components/DocxView.tsx` — the resolve effect
  (`useEffect` watching `[state.kind, detections, focusedId]`) runs
  three steps in order: `resolveDetections(host, detections)`,
  `applyHighlightRegistries(resolved, focusedId)`,
  `wrapDetections(host, resolved)`. Order matters because
  `applyHighlightRegistries` builds Highlight ranges over text nodes;
  the wrap leaves those text nodes intact (it only nests them deeper),
  so existing ranges keep painting correctly. `EditReplacement` reacts
  to store changes independently, finds the wraps that
  `wrapDetections` produced, and applies status + replacement DOM to
  each. The existing `host.replaceChildren()` cleanup on unmount tears
  down all wrappers when the doc is replaced.
- `src/renderer/src/review/highlights.ts` — drop the `previewing`
  registry from `REGISTRY_NAMES`, drop the `showsFirmPreview` branch
  from `applyHighlightRegistries`, update the file-level JSDoc to
  describe four registries instead of five. Signature unchanged.
- `src/renderer/src/review/segments.ts` —
  `rangeWithinElement` and `textOffsetWithin` walk text nodes via
  `TreeWalker(SHOW_TEXT)`. After wrap, the run element contains both
  the original text nodes (now nested inside `.sanctum-edit`) AND the
  replacement text node inside `.sanctum-edit-replacement`. The walker
  needs to skip the replacement subtree so character offsets keep
  matching the segment's source-text contract. Implement this by
  passing a `NodeFilter` to the walker that returns
  `FILTER_REJECT` for any text node whose ancestor chain includes a
  `.sanctum-edit-replacement` element. This is the only behavioural
  change in `segments.ts`; the public API is unchanged.
- `src/renderer/src/components/DetectionSidebar.tsx` — every list item
  renders a second line under the existing original-text display:
  `<span className="sidebar-item-replacement">→ {previews[d.id]}</span>`,
  conditional on `previews[d.id]` being set. Status-driven CSS controls
  emphasis (firm for accepted/pending-focused, faint for unfocused, greyed
  for rejected).
- `src/renderer/src/App.tsx` — drop the
  `<InlinePreview anchorRoot={docRoot} />` mount; mount
  `<EditReplacement anchorRoot={docRoot} />` in its place.
- `src/renderer/src/index.css`:
  - Add `.sanctum-edit` (default `display: inline`, no-op layout) and
    `.sanctum-edit-replacement` (firm oxblood mono italic, hidden by
    default).
  - Add the substitution rules:
    `.sanctum-edit[data-status="accepted"] .sanctum-edit-original { display: none }`
    and the matching show-replacement rule.
  - Add `.sidebar-item-replacement` styling — small, oxblood,
    truncated; opacity tier per row state (focused / accepted firm,
    unfocused-pending faint, rejected greyed).

## Data flow

No backend changes, no store-shape changes. Everything the new layout
needs already exists in the review store:

- `useReviewStore.detections` — drives both the wrap pass (status
  attribute on each wrap) and the sidebar list.
- `useReviewStore.previews` — backend-computed replacement text per
  detection ID. Drives `EditReplacement`'s portal content and the
  sidebar's "→ replacement" line.
- `useReviewStore.focusedId` — drives the `sanctum-focused` highlight
  and the sidebar's expanded controls. No longer drives any preview
  rendering.

When `previews[id]` is missing (first paint, before the backend
roundtrip lands, or standalone fake mode), `EditReplacement` renders
no replacement DOM for that detection and the sidebar drops the second
line. The wrap is still applied so accepted-state CSS would hide the
original — but with no replacement DOM, the user would see an empty
gap. To avoid that, the wrap step does **not** apply the
`data-status="accepted"` attribute when `previews[id]` is missing —
the wrap stays in `data-status="pending"`-equivalent visual state
(showing the original) regardless of decision until the preview lands.
This matches today's behaviour where the floating bubble was simply
absent until the preview map was populated.

## Edge cases

- **Range crosses element boundaries** —
  `Range.surroundContents` throws `InvalidStateError` when the start
  and end of the range live in different parent elements. The wrap pass
  catches that error per detection and skips wrapping for it. Effect:
  the highlight still paints (highlights API supports cross-boundary
  ranges), the sidebar still shows the replacement, and Accept still
  records the decision; only the in-document substitution is missing
  for that detection. A more permissive walk-and-wrap algorithm could
  be added later if this turns out to be common in practice — flagged
  in Risk / open questions.

- **Re-running the resolve effect** — `wrapDetections` is idempotent:
  for each detection it first looks for an existing
  `[data-detection-id="…"]` wrapper. If found, it updates the
  `data-status` attribute and moves on. If not found, it wraps the
  range. Removed detections (rare) are unwrapped on the same pass:
  before wrapping, the function queries every existing
  `.sanctum-edit` in `root` and unwraps any whose detection ID isn't
  in the current resolved set.

- **Custom replacement** — when the user has typed a custom replacement
  via the sidebar's "Edit replacement" input, the backend's preview
  reflects that string and lands in `previews[id]`. Both
  `EditReplacement` and the sidebar render that string verbatim. No
  extra plumbing.

- **Standalone fake mode** — `previews` is never populated. The wrap
  pass still runs but never assigns `data-status="accepted"`,
  `EditReplacement` renders nothing, and the sidebar drops the
  "→ replacement" line. The doc shows only originals, accept/reject
  still record decisions. Documented limitation, same scope as the
  shipped behaviour.

- **Un-accept** — flipping `accepted → pending` (e.g., the keyboard
  flow's reject-after-accept) just toggles `data-status` on the wrap.
  CSS re-shows the original instantly. No DOM mutation.

- **Re-render after a session change** — `DocxView`'s outer effect
  calls `host.replaceChildren()` on cleanup, which destroys all wraps
  along with the rest of the rendered docx. The next render goes
  through the same wrap pass. No persistence to leak.

- **Segment offset integrity after wrap** — naively rendering the
  replacement span inside the run element would change the run's
  `textContent` length and break the (segmentId, start, end) contract
  used to locate detections on subsequent resolves. The fix is the
  `segments.ts` TreeWalker filter described in the Architecture
  section: replacement text is invisible to offset math.
  `rangeToLocator` (used today only by potential user-made selections)
  inherits the same filter, so manual selection paths also stay
  correct.

## Testing

Unit (Vitest, happy-dom):

- `edit-wrap.test.ts` (new) — given a fixture root with three
  detections, `wrapDetections` produces three `.sanctum-edit`
  wrappers each containing the matching original text node. Calling it
  again with the same input is idempotent (wrapper identity
  preserved). Calling it with one detection removed unwraps that
  detection. Calling it on a detection whose range crosses element
  boundaries throws nothing and leaves the doc untouched for that
  detection.

- `segments.test.ts` (modify) — after a run element has been wrapped
  and a `.sanctum-edit-replacement` span has been mounted alongside,
  `findSegmentRange(root, locator)` still returns a Range covering the
  original text at the original offsets — replacement text must be
  invisible to the walker.

- `EditReplacement.test.tsx` (new) — with a body containing two wraps,
  the component portals one `.sanctum-edit-replacement` per wrap whose
  detection has a preview, and zero for detections without a preview.
  Updating the preview map updates the rendered text. Unmounting the
  component removes all portaled spans.

- `DetectionSidebar.test.tsx` (modify) — every row that has
  `previews[id]` set renders a `.sidebar-item-replacement` line with
  that text; rows without a preview don't. Status-driven class
  modifiers reflect rejected vs accepted vs pending.

- `highlights.test.ts` (modify) — drop the `previewing` registry
  assertions; the existing four-registry coverage stays.

Manual:

- `npm run dev`, open an existing OPEN session.
- Pending detections: each row in the sidebar shows the original plus
  the proposed replacement underneath. The document shows the original
  with the saffron dotted highlight.
- Focus a detection (click it / arrow-key down): oxblood outline
  appears, controls expand in the sidebar. Doc still shows the
  original.
- Accept (Enter): the detection in the doc swaps to the replacement
  text. Surrounding paragraph reflows around it. No overlay anywhere.
  The sidebar row turns verdigris-status; the "→ replacement" line is
  now firm.
- Walk down a few detections, accept some, reject others. Confirm the
  doc reads as a coherent redacted manuscript for the accepted runs
  and verbatim for the rejected/pending runs.
- Switch to a doc with dense detections (≥10 per paragraph) and
  confirm reflow doesn't visibly stutter on Accept.

## Out of scope

- Animating the substitution. A snap swap is fine — the visual change
  itself is the feedback. Motion can be a follow-up if it's wanted.
- A walk-and-wrap algorithm for ranges that cross element boundaries.
  The skip-fallback is acceptable for the rare cases where this
  happens; revisit only if real documents hit it often.
- Sidebar reordering / filtering / status grouping. Same scope
  boundary as the previous spec.
- Showing the original text alongside the replacement in the doc when
  accepted (e.g., a hover tooltip). The reviewer sees both halves in
  the sidebar; the doc is for reading the redacted result.

## Risk / open questions

- **Cross-boundary detections** — the failure mode is "no in-doc
  substitution for this one detection". If a real document trips this
  on, say, 5 % of its detections, the redacted doc reads inconsistently
  (some redactions visible, some not). Mitigation if it bites: the
  permissive walk-and-wrap algorithm — split the range into per-text-node
  subranges, wrap each, and render the replacement only inside the
  last subrange while hiding the rest. Doable but more code; deferred
  until evidence it's needed.

- **Performance of the wrap pass** — O(n) `Range.surroundContents`
  calls plus O(n) React portal mounts per resolve. For documents with
  hundreds of detections, this could be a noticeable spike on the
  first paint. Mitigation if it bites: batch the wrap inside a single
  `requestAnimationFrame`, or use `DocumentFragment`-based mutation.
  Worth a smoke test before optimising.

- **Idempotency of `wrapDetections`** — the design assumes detections
  don't change identity between resolves. If the backend ever swaps a
  detection's ID while keeping its range, the old wrap would get
  unwrapped and a new one created, briefly losing focus. The current
  API contract treats detection IDs as stable for a session, so this
  is theoretical, but worth flagging.
