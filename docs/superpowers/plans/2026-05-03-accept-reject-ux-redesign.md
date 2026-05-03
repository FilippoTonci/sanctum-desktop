# Accept/Reject UX redesign — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the floating per-detection tooltip with a sidebar-driven flow + inline preview text, per the design spec at `docs/superpowers/specs/2026-05-03-accept-reject-ux-redesign-design.md`.

**Architecture:** The CSS Custom Highlight API gains a fifth registry (`sanctum-previewing`) that strikes through original text on focused-pending and accepted detections. A new `InlinePreview` component renders one floating-ui-positioned span per detection with a backend-computed preview, in faint or firm style. The `DetectionSidebar` grows the focused row in place to host the operator picker + edit-replacement + accept/reject controls that used to live in `DetectionTooltip`. `DetectionTooltip` and `PreviewOverlay` are deleted.

**Tech Stack:** TypeScript, React 18, Zustand store, `@floating-ui/react`, CSS Custom Highlight API, Vitest (happy-dom for renderer specs).

---

## File structure

| Path                                               | Action | Purpose                                                                                                                                                                                                                                                                        |
| -------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/renderer/src/review/highlights.ts`            | modify | Add `sanctum-previewing` registry; route focused-pending + accepted ranges into it.                                                                                                                                                                                            |
| `src/renderer/src/index.css`                       | modify | Add `::highlight(sanctum-previewing)`; remove `text-decoration: line-through` from `::highlight(sanctum-rejected)`; remove `.detection-tooltip-*` and `.preview-bubble-*`; add `.inline-preview` / `.inline-preview-firm`; add `.detection-sidebar-item-controls` and friends. |
| `src/renderer/src/components/InlinePreview.tsx`    | create | Replaces `PreviewOverlay`. Renders one positioned span per detection with a preview, with per-state class.                                                                                                                                                                     |
| `src/renderer/src/components/DetectionSidebar.tsx` | modify | Focused row inline-expands with operator dropdown + edit-replacement + accept/reject.                                                                                                                                                                                          |
| `src/renderer/src/App.tsx`                         | modify | Swap `<DetectionTooltip>` + `<PreviewOverlay>` for `<InlinePreview>`. Drop unused imports.                                                                                                                                                                                     |
| `src/renderer/src/components/DetectionTooltip.tsx` | delete | Functionality moves into the sidebar.                                                                                                                                                                                                                                          |
| `src/renderer/src/components/PreviewOverlay.tsx`   | delete | Replaced by `InlinePreview`.                                                                                                                                                                                                                                                   |
| `tests/unit/renderer/highlights.test.ts`           | modify | New cases for the `sanctum-previewing` registry.                                                                                                                                                                                                                               |
| `tests/unit/renderer/inline-preview.test.ts`       | create | Cover the `pickPreviewVariant` pure helper.                                                                                                                                                                                                                                    |
| `tests/unit/renderer/detection-sidebar.test.ts`    | create | Cover the `pickFocusedControlsState` pure helper.                                                                                                                                                                                                                              |
| `README.md` (project root)                         | modify | Tick the "Accept/Reject UX redesign" box if present in the roadmap.                                                                                                                                                                                                            |

Note on test conventions: this codebase doesn't ship `@testing-library/react`. Existing `tests/unit/renderer/*.test.ts` files unit-test pure helpers extracted from components. We follow that same pattern — extract decision logic into pure functions, unit-test them, and verify the rendered behaviour by hand via `agent-browser` in dev.

---

## Task 1: Extend the highlight registries with `sanctum-previewing`

**Files:**

- Modify: `src/renderer/src/review/highlights.ts:19-86`
- Test: `tests/unit/renderer/highlights.test.ts` (new cases at end)

- [ ] **Step 1: Write a failing test for the new registry membership**

Append to `tests/unit/renderer/highlights.test.ts`:

```typescript
// @vitest-environment happy-dom
import { applyHighlightRegistries } from '../../../src/renderer/src/review/highlights'

interface FakeRegistry {
  ranges: Range[]
  clear(): void
  add(range: Range): void
}

function installHighlightApi(): Record<string, FakeRegistry> {
  const map: Record<string, FakeRegistry> = {}
  // happy-dom doesn't ship the Highlight API; install a stub that the
  // production code will treat as present.
  ;(globalThis as unknown as { Highlight: unknown }).Highlight = class {
    ranges: Range[] = []
    clear(): void {
      this.ranges = []
    }
    add(range: Range): void {
      this.ranges.push(range)
    }
  }
  ;(
    CSS as unknown as {
      highlights: {
        get: (n: string) => FakeRegistry | undefined
        set: (n: string, h: FakeRegistry) => void
      }
    }
  ).highlights = {
    get: (name) => map[name],
    set: (name, h) => {
      map[name] = h
    },
  }
  return map
}

describe('applyHighlightRegistries — sanctum-previewing', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('adds focused-pending and accepted ranges to sanctum-previewing; excludes rejected and unfocused-pending', () => {
    const registries = installHighlightApi()
    const root = setBody(
      '<p><span data-segment-id="body/p0/r0">Alice and Bob and Carol and Dan.</span></p>',
    )
    const detections: Detection[] = [
      {
        id: 'a',
        segmentId: 'body/p0/r0',
        start: 0,
        end: 5,
        text: 'Alice',
        entityType: 'PERSON',
        status: 'pending',
      },
      {
        id: 'b',
        segmentId: 'body/p0/r0',
        start: 10,
        end: 13,
        text: 'Bob',
        entityType: 'PERSON',
        status: 'accepted',
      },
      {
        id: 'c',
        segmentId: 'body/p0/r0',
        start: 18,
        end: 23,
        text: 'Carol',
        entityType: 'PERSON',
        status: 'rejected',
      },
      {
        id: 'd',
        segmentId: 'body/p0/r0',
        start: 28,
        end: 31,
        text: 'Dan',
        entityType: 'PERSON',
        status: 'pending',
      },
    ]
    const resolved = resolveDetections(root, detections)
    const ok = applyHighlightRegistries(resolved, 'a')
    expect(ok).toBe(true)

    const previewing = registries['sanctum-previewing']
    expect(previewing).toBeDefined()
    const previewingTexts = previewing!.ranges.map((r) => r.toString())
    expect(previewingTexts).toEqual(expect.arrayContaining(['Alice', 'Bob']))
    expect(previewingTexts).not.toContain('Carol')
    expect(previewingTexts).not.toContain('Dan')
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
npm test -- tests/unit/renderer/highlights.test.ts
```

Expected: FAIL — the new `describe` fails because `sanctum-previewing` is undefined or empty.

- [ ] **Step 3: Implement the registry extension**

Edit `src/renderer/src/review/highlights.ts`. Replace the `REGISTRY_NAMES` constant and the loop inside `applyHighlightRegistries`:

```typescript
const REGISTRY_NAMES = {
  pending: 'sanctum-pending',
  accepted: 'sanctum-accepted',
  rejected: 'sanctum-rejected',
  focused: 'sanctum-focused',
  previewing: 'sanctum-previewing',
} as const
```

Inside `applyHighlightRegistries`, after building the `registry` map, add the new registry to the map and add the membership branch in the for-loop:

```typescript
const registry: Record<RegistryName, Highlight> = {
  [REGISTRY_NAMES.pending]: ensureRegistry(REGISTRY_NAMES.pending),
  [REGISTRY_NAMES.accepted]: ensureRegistry(REGISTRY_NAMES.accepted),
  [REGISTRY_NAMES.rejected]: ensureRegistry(REGISTRY_NAMES.rejected),
  [REGISTRY_NAMES.focused]: ensureRegistry(REGISTRY_NAMES.focused),
  [REGISTRY_NAMES.previewing]: ensureRegistry(REGISTRY_NAMES.previewing),
}

for (const name of Object.values(REGISTRY_NAMES)) {
  registry[name].clear()
}

for (const { detection, range } of resolved) {
  registry[REGISTRY_NAMES[detection.status]].add(range)
  if (detection.id === focusedId) {
    registry[REGISTRY_NAMES.focused].add(range)
  }
  // Strikethrough source text whenever the proposed replacement is
  // shown firmly: accepted detections, and the single focused-pending
  // one. See the design spec (§ User-visible behaviour).
  const showsFirmPreview =
    detection.status === 'accepted' ||
    (detection.status === 'pending' && detection.id === focusedId)
  if (showsFirmPreview) {
    registry[REGISTRY_NAMES.previewing].add(range)
  }
}
```

Update the file's top-of-file doc comment to mention the fifth registry:

```typescript
/**
 * Drive the CSS Custom Highlight API from a list of detections.
 *
 * Five registries are maintained:
 *
 *   sanctum-pending     — detections the reviewer hasn't acted on
 *   sanctum-accepted    — detections the reviewer marked accept
 *   sanctum-rejected    — detections the reviewer marked reject
 *   sanctum-focused     — the single detection currently focused (overlay
 *                          on top of one of the three above)
 *   sanctum-previewing  — accepted + focused-pending; styled with
 *                          strikethrough so the original reads as the
 *                          source the proposed replacement is replacing
 *
 * The CSS in `index.css` paints each registry. The renderer just owns
 * which Range goes into which registry on every state change.
 */
```

- [ ] **Step 4: Run tests and confirm they pass**

```bash
npm test -- tests/unit/renderer/highlights.test.ts
```

Expected: PASS — including the new case and the existing `resolveDetections` / `seedFakeDetections` ones.

- [ ] **Step 5: Lint + typecheck**

```bash
npm run lint && npm run typecheck
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/review/highlights.ts tests/unit/renderer/highlights.test.ts
git commit -m "Add sanctum-previewing highlight registry (Phase 3 issue #23)"
```

---

## Task 2: CSS — paint `sanctum-previewing`, drop the rejected line-through

**Files:**

- Modify: `src/renderer/src/index.css:925-946`

- [ ] **Step 1: Edit the four highlight rules**

Find the block at `src/renderer/src/index.css:925-946`. Replace the rejected and add a previewing rule. Final shape of the block:

```css
/* CSS Custom Highlight API — accept/pending/reject markings. */
::highlight(sanctum-pending) {
  background-color: rgba(217, 168, 84, 0.36);
  text-decoration: underline dotted rgba(168, 115, 23, 0.85);
  text-underline-offset: 3px;
}

::highlight(sanctum-accepted) {
  background-color: rgba(135, 179, 154, 0.32);
  text-decoration: underline solid rgba(63, 107, 84, 0.8);
  text-underline-offset: 3px;
}

::highlight(sanctum-rejected) {
  /* Background-only — rejected means "keep the original verbatim",
     so striking the text out reads wrong (issue #23). */
  background-color: rgba(180, 174, 162, 0.22);
}

::highlight(sanctum-focused) {
  background-color: rgba(124, 32, 24, 0.3);
  outline: 2px solid var(--oxblood);
}

::highlight(sanctum-previewing) {
  /* Strikethrough + faded ink on detections whose replacement is shown
     firmly (accepted, focused-pending). Pairs with .inline-preview-firm. */
  text-decoration: line-through rgba(124, 32, 24, 0.6);
  color: rgba(118, 107, 91, 0.78);
}
```

- [ ] **Step 2: Lint (Prettier may reformat the block)**

```bash
npm run lint
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/index.css
git commit -m "Style sanctum-previewing; drop line-through from sanctum-rejected (Phase 3 issue #23)"
```

---

## Task 3: New `InlinePreview` component

**Files:**

- Create: `src/renderer/src/components/InlinePreview.tsx`
- Create: `tests/unit/renderer/inline-preview.test.ts`

- [ ] **Step 1: Write a failing test for the pure variant picker**

Create `tests/unit/renderer/inline-preview.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { pickPreviewVariant } from '../../../src/renderer/src/components/InlinePreview'
import type { Detection } from '../../../src/renderer/src/review/types'

function detection(overrides: Partial<Detection>): Detection {
  return {
    id: 'd0',
    segmentId: 'body/p0/r0',
    start: 0,
    end: 5,
    text: 'Alice',
    entityType: 'PERSON',
    status: 'pending',
    ...overrides,
  }
}

describe('pickPreviewVariant', () => {
  it('returns null when there is no preview text', () => {
    expect(pickPreviewVariant(detection({ status: 'pending' }), 'd0', undefined)).toBeNull()
    expect(pickPreviewVariant(detection({ status: 'accepted' }), null, undefined)).toBeNull()
  })

  it('returns null for rejected detections regardless of focus', () => {
    expect(pickPreviewVariant(detection({ status: 'rejected', id: 'r0' }), 'r0', '<X>')).toBeNull()
    expect(pickPreviewVariant(detection({ status: 'rejected', id: 'r0' }), null, '<X>')).toBeNull()
  })

  it('returns "firm" for accepted detections', () => {
    expect(pickPreviewVariant(detection({ status: 'accepted', id: 'a0' }), null, '<X>')).toBe(
      'firm',
    )
    expect(pickPreviewVariant(detection({ status: 'accepted', id: 'a0' }), 'a0', '<X>')).toBe(
      'firm',
    )
  })

  it('returns "firm" for the focused pending detection and "faint" for unfocused pending', () => {
    expect(pickPreviewVariant(detection({ status: 'pending', id: 'p0' }), 'p0', '<X>')).toBe('firm')
    expect(pickPreviewVariant(detection({ status: 'pending', id: 'p0' }), 'p1', '<X>')).toBe(
      'faint',
    )
    expect(pickPreviewVariant(detection({ status: 'pending', id: 'p0' }), null, '<X>')).toBe(
      'faint',
    )
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
npm test -- tests/unit/renderer/inline-preview.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create the component file**

Create `src/renderer/src/components/InlinePreview.tsx`:

```tsx
import { autoUpdate, offset, shift, useFloating } from '@floating-ui/react'
import { useEffect, useMemo, type ReactElement } from 'react'
import { findSegmentRange } from '../review/segments'
import { useReviewStore } from '../review/store'
import type { Detection, DetectionStatus } from '../review/types'

interface InlinePreviewProps {
  /** The DocxView body element; preview spans position against ranges inside it. */
  readonly anchorRoot: HTMLElement | null
}

export type PreviewVariant = 'faint' | 'firm'

/**
 * Decide whether a detection should render an inline preview, and at
 * what intensity. Pure helper, exported for unit testing.
 *
 *   accepted              → firm     (replacement materialises)
 *   pending && focused    → firm     (the one the reviewer is acting on)
 *   pending && !focused   → faint    (a calm "this is what we'd do")
 *   rejected | no preview → null     (nothing to show)
 */
export function pickPreviewVariant(
  detection: Detection,
  focusedId: string | null,
  preview: string | undefined,
): PreviewVariant | null {
  if (preview === undefined) return null
  const status: DetectionStatus = detection.status
  if (status === 'rejected') return null
  if (status === 'accepted') return 'firm'
  return detection.id === focusedId ? 'firm' : 'faint'
}

/**
 * Render the backend-computed preview text as a floating span next to
 * each detection that has one. The span is positioned with floating-ui
 * (placement="right") and absorbs what `PreviewOverlay` used to do for
 * accepted detections — this version handles every visible state.
 *
 * The preview map is sourced from the review store and updated by every
 * PATCH/POST that touches a decision (see `review/actions.ts::recordPreview`).
 *
 * Standalone fake mode never populates the preview map, so this
 * component renders nothing in that path. Documented limitation, same
 * as the old `PreviewOverlay`.
 */
export function InlinePreview({ anchorRoot }: InlinePreviewProps): ReactElement | null {
  const detections = useReviewStore((s) => s.detections)
  const focusedId = useReviewStore((s) => s.focusedId)
  const previews = useReviewStore((s) => s.previews)

  if (anchorRoot === null) return null

  const visible: { detection: Detection; preview: string; variant: PreviewVariant }[] = []
  for (const detection of detections) {
    const variant = pickPreviewVariant(detection, focusedId, previews[detection.id])
    if (variant === null) continue
    const previewText = previews[detection.id]
    if (previewText === undefined) continue
    visible.push({ detection, preview: previewText, variant })
  }

  return (
    <>
      {visible.map(({ detection, preview, variant }) => (
        <InlinePreviewSpan
          key={detection.id}
          anchorRoot={anchorRoot}
          detection={detection}
          preview={preview}
          variant={variant}
        />
      ))}
    </>
  )
}

interface InlinePreviewSpanProps {
  readonly anchorRoot: HTMLElement
  readonly detection: Detection
  readonly preview: string
  readonly variant: PreviewVariant
}

function InlinePreviewSpan({
  anchorRoot,
  detection,
  preview,
  variant,
}: InlinePreviewSpanProps): ReactElement | null {
  const virtualReference = useMemo(() => {
    const range = findSegmentRange(anchorRoot, {
      segmentId: detection.segmentId,
      start: detection.start,
      end: detection.end,
    })
    if (range === null) return null
    return { getBoundingClientRect: () => range.getBoundingClientRect() }
  }, [anchorRoot, detection])

  const { refs, floatingStyles } = useFloating({
    placement: 'right',
    middleware: [offset(6), shift({ padding: 4 })],
    whileElementsMounted: autoUpdate,
  })

  useEffect(() => {
    refs.setReference(virtualReference)
  }, [refs, virtualReference])

  if (virtualReference === null) return null

  return (
    <span
      ref={refs.setFloating}
      style={floatingStyles}
      className={`inline-preview${variant === 'firm' ? ' inline-preview-firm' : ''}`}
      data-testid="inline-preview"
      data-detection-id={detection.id}
      data-variant={variant}
      aria-hidden="true"
    >
      {preview}
    </span>
  )
}
```

- [ ] **Step 4: Run the test and confirm it passes**

```bash
npm test -- tests/unit/renderer/inline-preview.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Lint + typecheck**

```bash
npm run lint && npm run typecheck
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/InlinePreview.tsx tests/unit/renderer/inline-preview.test.ts
git commit -m "Add InlinePreview component (Phase 3 issue #23)"
```

---

## Task 4: CSS for inline-preview spans

**Files:**

- Modify: `src/renderer/src/index.css` (insert near the now-removed preview-bubble block; for now, append at the end of the file — Task 8 will clean up the section comment)

- [ ] **Step 1: Append the inline-preview rules**

Add to `src/renderer/src/index.css` (location is fine anywhere outside the `@media` blocks; append at end of file is acceptable):

```css
/* =========================================================================
   Inline preview — replacement text floated next to each detection.
   See: docs/superpowers/specs/2026-05-03-accept-reject-ux-redesign-design.md
   ========================================================================= */

.inline-preview {
  position: absolute;
  z-index: 25;
  font-family: var(--font-mono);
  font-style: italic;
  font-size: 0.78rem;
  letter-spacing: 0.02em;
  color: var(--saffron);
  opacity: 0.55;
  white-space: nowrap;
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
  /* Sit on the document text baseline, not above it. */
  padding: 0 0.25rem;
}

.inline-preview-firm {
  color: var(--oxblood);
  opacity: 1;
  font-weight: 500;
}

@media (prefers-color-scheme: dark) {
  .inline-preview {
    color: var(--saffron);
    opacity: 0.65;
  }
  .inline-preview-firm {
    color: var(--oxblood);
    opacity: 1;
  }
}
```

- [ ] **Step 2: Lint**

```bash
npm run lint
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/index.css
git commit -m "Style inline-preview spans (Phase 3 issue #23)"
```

---

## Task 5: Sidebar focused-row controls

**Files:**

- Modify: `src/renderer/src/components/DetectionSidebar.tsx`
- Create: `tests/unit/renderer/detection-sidebar.test.ts`

- [ ] **Step 1: Write a failing test for the pure focused-controls picker**

Create `tests/unit/renderer/detection-sidebar.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { pickFocusedControlsState } from '../../../src/renderer/src/components/DetectionSidebar'
import type { Detection } from '../../../src/renderer/src/review/types'

function detection(overrides: Partial<Detection>): Detection {
  return {
    id: 'd0',
    segmentId: 'body/p0/r0',
    start: 0,
    end: 5,
    text: 'Alice',
    entityType: 'PERSON',
    status: 'pending',
    ...overrides,
  }
}

describe('pickFocusedControlsState', () => {
  it('returns null for non-focused rows', () => {
    expect(
      pickFocusedControlsState(detection({ id: 'd0' }), 'd1', null, 'replace', false),
    ).toBeNull()
  })

  it('returns the read-mode shape for the focused row when not editing', () => {
    const state = pickFocusedControlsState(
      detection({ id: 'd0', operator: 'mask' }),
      'd0',
      null,
      'replace',
      true,
    )
    expect(state).not.toBeNull()
    expect(state!.editing).toBe(false)
    expect(state!.effectiveOperator).toBe('mask')
    expect(state!.pseudonymizeLocked).toBe(false)
  })

  it('falls back to the session default operator when none is set on the detection', () => {
    const state = pickFocusedControlsState(
      detection({ id: 'd0', operator: undefined }),
      'd0',
      null,
      'redact',
      true,
    )
    expect(state!.effectiveOperator).toBe('redact')
  })

  it('flips into edit mode when editingReplacementId matches', () => {
    const state = pickFocusedControlsState(detection({ id: 'd0' }), 'd0', 'd0', 'replace', true)
    expect(state!.editing).toBe(true)
  })

  it('marks pseudonymize as locked when the mapping store is locked', () => {
    const state = pickFocusedControlsState(
      detection({ id: 'd0', operator: 'pseudonymize' }),
      'd0',
      null,
      'replace',
      false,
    )
    expect(state!.pseudonymizeLocked).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
npm test -- tests/unit/renderer/detection-sidebar.test.ts
```

Expected: FAIL — `pickFocusedControlsState` not exported.

- [ ] **Step 3: Replace `src/renderer/src/components/DetectionSidebar.tsx` with the expanded version**

Full new contents:

```tsx
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useReviewStore } from '../review/store'
import {
  OPERATOR_NAMES,
  type Detection,
  type DetectionStatus,
  type OperatorName,
} from '../review/types'
import { useReviewActions } from '../review/use-actions'

const STATUS_LABEL: Record<DetectionStatus, string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  rejected: 'Rejected',
}

export interface FocusedControlsState {
  readonly editing: boolean
  readonly effectiveOperator: OperatorName
  readonly pseudonymizeLocked: boolean
}

/**
 * Pure helper deciding what shape the focused row's controls block
 * should render in. Returns `null` for non-focused rows so callers can
 * skip the controls entirely.
 *
 * Exported for unit testing — the JSX consumer below is a thin wrapper.
 */
export function pickFocusedControlsState(
  detection: Detection,
  focusedId: string | null,
  editingReplacementId: string | null,
  defaultOperator: OperatorName,
  mappingUnlocked: boolean,
): FocusedControlsState | null {
  if (detection.id !== focusedId) return null
  const effectiveOperator = detection.operator ?? defaultOperator
  return {
    editing: editingReplacementId === detection.id,
    effectiveOperator,
    pseudonymizeLocked: effectiveOperator === 'pseudonymize' && !mappingUnlocked,
  }
}

export function DetectionSidebar(): ReactElement {
  const detections = useReviewStore((s) => s.detections)
  const focusedId = useReviewStore((s) => s.focusedId)
  const setFocused = useReviewStore((s) => s.setFocused)
  const openCommit = useReviewStore((s) => s.openCommitPanel)
  const editingReplacementId = useReviewStore((s) => s.editingReplacementId)
  const startEditingReplacement = useReviewStore((s) => s.startEditingReplacement)
  const defaultOperator = useReviewStore((s) => s.defaultOperator)
  const mappingUnlocked = useReviewStore((s) => s.mappingStoreUnlocked) === true
  const actions = useReviewActions()

  const counts = aggregate(detections)
  const canCommit = detections.length > 0 && counts.pending === 0

  return (
    <aside className="detection-sidebar" aria-label="Detection list">
      <header className="sidebar-header">
        <h2>Detections</h2>
        <p className="sidebar-counts">
          <span>{String(counts.pending)} pending</span>
          {' · '}
          <span>{String(counts.accepted)} accepted</span>
          {' · '}
          <span>{String(counts.rejected)} rejected</span>
        </p>
      </header>
      {detections.length === 0 ? (
        <p className="sidebar-empty">No detections yet.</p>
      ) : (
        <ul className="sidebar-list">
          {detections.map((d) => {
            const focusedState = pickFocusedControlsState(
              d,
              focusedId,
              editingReplacementId,
              defaultOperator,
              mappingUnlocked,
            )
            return (
              <li key={d.id}>
                <button
                  type="button"
                  className={`sidebar-item sidebar-item-${d.status}${
                    d.id === focusedId ? ' sidebar-item-focused' : ''
                  }`}
                  onClick={() => {
                    setFocused(d.id)
                  }}
                  aria-pressed={d.id === focusedId}
                >
                  <span className="sidebar-item-text">{d.text}</span>
                  <span className="sidebar-item-meta">
                    <span className="sidebar-item-entity">{d.entityType}</span>
                    <span className={`sidebar-item-status sidebar-item-status-${d.status}`}>
                      {STATUS_LABEL[d.status]}
                    </span>
                  </span>
                </button>
                {focusedState !== null ? (
                  <FocusedControls
                    detection={d}
                    state={focusedState}
                    onSetOperator={(op) => {
                      actions.setOperator(d.id, op)
                    }}
                    onAccept={() => {
                      actions.accept(d.id)
                    }}
                    onReject={() => {
                      actions.reject(d.id)
                    }}
                    onStartEdit={() => {
                      startEditingReplacement(d.id)
                    }}
                    onCancelEdit={() => {
                      startEditingReplacement(null)
                    }}
                    onCommitReplacement={(value) => {
                      actions.setCustomReplacement(d.id, value.length === 0 ? null : value)
                      startEditingReplacement(null)
                    }}
                  />
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
      <footer className="sidebar-footer">
        <button
          type="button"
          className="sidebar-commit"
          disabled={!canCommit}
          onClick={openCommit}
          title={
            canCommit
              ? 'Open commit panel (Ctrl/Cmd + Enter)'
              : 'Resolve every pending detection before committing'
          }
        >
          Commit…
        </button>
      </footer>
    </aside>
  )
}

interface FocusedControlsProps {
  readonly detection: Detection
  readonly state: FocusedControlsState
  readonly onSetOperator: (op: OperatorName) => void
  readonly onAccept: () => void
  readonly onReject: () => void
  readonly onStartEdit: () => void
  readonly onCancelEdit: () => void
  readonly onCommitReplacement: (value: string) => void
}

function FocusedControls({
  detection,
  state,
  onSetOperator,
  onAccept,
  onReject,
  onStartEdit,
  onCancelEdit,
  onCommitReplacement,
}: FocusedControlsProps): ReactElement {
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (state.editing) {
      setDraft(detection.customReplacement ?? '')
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [state.editing, detection.customReplacement])

  return (
    <div className="detection-sidebar-item-controls" data-testid="focused-controls">
      <label
        className={`detection-sidebar-item-operator${
          detection.customReplacement !== undefined
            ? ' detection-sidebar-item-operator-bypassed'
            : ''
        }`}
      >
        Operator
        <select
          value={state.effectiveOperator}
          disabled={detection.customReplacement !== undefined}
          onChange={(e) => {
            onSetOperator(e.currentTarget.value as OperatorName)
          }}
        >
          {OPERATOR_NAMES.map((op) => {
            const locked = op === 'pseudonymize' && state.pseudonymizeLocked
            return (
              <option key={op} value={op} disabled={locked}>
                {op}
                {locked ? ' — mapping store locked' : ''}
              </option>
            )
          })}
        </select>
        {state.pseudonymizeLocked && state.effectiveOperator === 'pseudonymize' ? (
          <span className="detection-sidebar-item-hint">
            Unlock the mapping store before committing.
          </span>
        ) : detection.customReplacement !== undefined ? (
          <span className="detection-sidebar-item-hint">Bypassed by custom replacement below.</span>
        ) : null}
      </label>

      {state.editing ? (
        <div className="detection-sidebar-item-edit">
          <input
            ref={inputRef}
            type="text"
            value={draft}
            placeholder="Custom replacement…"
            onChange={(e) => {
              setDraft(e.currentTarget.value)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                onCommitReplacement(draft)
              } else if (e.key === 'Escape') {
                e.preventDefault()
                onCancelEdit()
              }
            }}
          />
          <button
            type="button"
            className="detection-sidebar-item-edit-cancel"
            onClick={onCancelEdit}
          >
            Cancel
          </button>
        </div>
      ) : detection.customReplacement !== undefined ? (
        <p className="detection-sidebar-item-replacement">
          Replace with: <code>{detection.customReplacement}</code>
          <button type="button" className="detection-sidebar-item-edit-start" onClick={onStartEdit}>
            Edit
          </button>
        </p>
      ) : (
        <button type="button" className="detection-sidebar-item-edit-start" onClick={onStartEdit}>
          Edit replacement
        </button>
      )}

      <div className="detection-sidebar-item-actions">
        <button type="button" className="detection-sidebar-item-accept" onClick={onAccept}>
          Accept ↵
        </button>
        <button type="button" className="detection-sidebar-item-reject" onClick={onReject}>
          Reject ⌫
        </button>
      </div>
    </div>
  )
}

function aggregate(detections: readonly Detection[]): Record<DetectionStatus, number> {
  const out: Record<DetectionStatus, number> = { pending: 0, accepted: 0, rejected: 0 }
  for (const d of detections) out[d.status]++
  return out
}
```

- [ ] **Step 4: Run the new test and confirm it passes**

```bash
npm test -- tests/unit/renderer/detection-sidebar.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Run the existing test suite to confirm nothing else broke**

```bash
npm test
```

Expected: every existing renderer test continues to pass. (The sidebar is still using the same store actions; nothing in the existing tests references the deleted tooltip.)

- [ ] **Step 6: Lint + typecheck**

```bash
npm run lint && npm run typecheck
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/DetectionSidebar.tsx tests/unit/renderer/detection-sidebar.test.ts
git commit -m "Move per-detection controls into the focused sidebar row (Phase 3 issue #23)"
```

---

## Task 6: CSS for sidebar focused-row controls

**Files:**

- Modify: `src/renderer/src/index.css` (append, near the existing `.sidebar-*` rules)

- [ ] **Step 1: Locate the existing sidebar block**

```bash
grep -n "^\.sidebar-item\b\|^\.detection-sidebar\b" src/renderer/src/index.css | head -10
```

Note the line numbers. The new rules go _after_ the last `.sidebar-*` rule.

- [ ] **Step 2: Append the new rules**

Add to `src/renderer/src/index.css`:

```css
/* Focused row's expanded controls — operator, edit, accept/reject. */
.detection-sidebar-item-controls {
  margin: 0.4rem 0 0.6rem;
  padding: 0.7rem 0.8rem 0.8rem;
  border-radius: var(--radius-md);
  background: var(--paper-elevated);
  border: 1px solid var(--hairline-strong);
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.detection-sidebar-item-operator {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  font-family: var(--font-mono);
  font-size: 0.7rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-muted);
}

.detection-sidebar-item-operator select {
  padding: 0.35rem 0.5rem;
  border: 1px solid var(--hairline-strong);
  border-radius: var(--radius-sm);
  font-family: var(--font-body);
  font-size: 0.85rem;
  letter-spacing: normal;
  text-transform: none;
  background: var(--paper);
  color: var(--ink);
}

.detection-sidebar-item-operator-bypassed select {
  opacity: 0.55;
}

.detection-sidebar-item-hint {
  font-family: var(--font-body);
  font-size: 0.72rem;
  letter-spacing: normal;
  text-transform: none;
  color: var(--ink-muted);
  font-style: italic;
}

.detection-sidebar-item-edit {
  display: flex;
  gap: 0.4rem;
  align-items: center;
}

.detection-sidebar-item-edit input {
  flex: 1;
  padding: 0.35rem 0.5rem;
  border: 1px solid var(--hairline-strong);
  border-radius: var(--radius-sm);
  font-family: var(--font-body);
  font-size: 0.85rem;
  background: var(--paper);
  color: var(--ink);
}

.detection-sidebar-item-edit-cancel,
.detection-sidebar-item-edit-start {
  background: transparent;
  border: 1px solid var(--hairline-strong);
  border-radius: var(--radius-sm);
  padding: 0.3rem 0.55rem;
  font-family: var(--font-mono);
  font-size: 0.7rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-soft);
  cursor: pointer;
}

.detection-sidebar-item-edit-cancel:hover,
.detection-sidebar-item-edit-start:hover {
  background: var(--paper-sunken);
  color: var(--ink);
}

.detection-sidebar-item-replacement {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  font-size: 0.85rem;
  color: var(--ink-soft);
}

.detection-sidebar-item-replacement code {
  background: var(--paper-sunken);
  padding: 0.1rem 0.4rem;
  border-radius: var(--radius-sm);
  font-size: 0.85rem;
  font-family: var(--font-mono);
  border: 1px solid var(--hairline);
}

.detection-sidebar-item-actions {
  display: flex;
  gap: 0.45rem;
  margin-top: 0.2rem;
}

.detection-sidebar-item-accept,
.detection-sidebar-item-reject {
  flex: 1;
  padding: 0.45rem 0.55rem;
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: 0.78rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  cursor: pointer;
  border: 1px solid var(--hairline-strong);
  background: transparent;
  color: var(--ink-soft);
}

.detection-sidebar-item-accept {
  background: var(--oxblood);
  color: var(--paper);
  border-color: var(--oxblood);
}

.detection-sidebar-item-accept:hover {
  background: var(--oxblood-hover);
}

.detection-sidebar-item-reject:hover {
  background: var(--paper-sunken);
  color: var(--ink);
}
```

- [ ] **Step 3: Lint**

```bash
npm run lint
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/index.css
git commit -m "Style sidebar focused-row controls (Phase 3 issue #23)"
```

---

## Task 7: Wire `App.tsx` to use `InlinePreview` and drop the tooltip + overlay

**Files:**

- Modify: `src/renderer/src/App.tsx:6-11,302-320`

- [ ] **Step 1: Update imports**

Edit `src/renderer/src/App.tsx`. Remove the two now-dead imports and add the new one. The relevant import lines change from:

```typescript
import { DetectionSidebar } from './components/DetectionSidebar'
import { DetectionTooltip } from './components/DetectionTooltip'
// …
import { PreviewOverlay } from './components/PreviewOverlay'
```

…to:

```typescript
import { DetectionSidebar } from './components/DetectionSidebar'
import { InlinePreview } from './components/InlinePreview'
```

(Sort imports alphabetically per the existing file convention.)

- [ ] **Step 2: Replace the JSX block at App.tsx:312-314**

Change:

```tsx
            <DetectionSidebar />
            <DetectionTooltip anchorRoot={docRoot} />
            <PreviewOverlay anchorRoot={docRoot} />
```

…to:

```tsx
            <DetectionSidebar />
            <InlinePreview anchorRoot={docRoot} />
```

- [ ] **Step 3: Run typecheck + lint**

```bash
npm run typecheck && npm run lint
```

Expected: clean.

- [ ] **Step 4: Run the full test suite**

```bash
npm test
```

Expected: every test continues to pass.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "Mount InlinePreview; drop tooltip + overlay from review surface (Phase 3 issue #23)"
```

---

## Task 8: Delete dead components and clean up CSS

**Files:**

- Delete: `src/renderer/src/components/DetectionTooltip.tsx`
- Delete: `src/renderer/src/components/PreviewOverlay.tsx`
- Modify: `src/renderer/src/index.css` (remove `.detection-tooltip-*` and `.preview-bubble-*` blocks plus their section comments)

- [ ] **Step 1: Delete the two component files**

```bash
git rm src/renderer/src/components/DetectionTooltip.tsx
git rm src/renderer/src/components/PreviewOverlay.tsx
```

- [ ] **Step 2: Remove the dead CSS blocks**

Open `src/renderer/src/index.css` and delete:

1. The block starting at the comment

   ```
   /* =========================================================================
      Detection tooltip — anchored to a span; the inquisitor's loupe.
      ========================================================================= */
   ```

   …through the last `.detection-tooltip-*` rule (originally `.detection-tooltip-replacement code { … }`).

2. The block starting at the comment

   ```
   /* =========================================================================
      Preview bubble + select-mode banner.
      ========================================================================= */
   ```

   …through the `.preview-bubble-text { … }` rule. Re-add a slimmed section comment so the next rule (`.select-mode-banner`) keeps a meaningful header:

   ```css
   /* =========================================================================
      Select-mode banner.
      ========================================================================= */
   ```

   Leave the `.select-mode-banner` rule (and everything after it) untouched.

   Verify with:

   ```bash
   grep -n "preview-bubble\|detection-tooltip" src/renderer/src/index.css
   ```

   Expected: empty output — every match for those class prefixes is gone.

- [ ] **Step 3: Run the full quality gate**

```bash
npm run typecheck && npm run lint && npm test
```

Expected: every check clean. Lint will fail on any leftover unused imports or stale references — fix them inline if so.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Delete DetectionTooltip + PreviewOverlay, drop their CSS (Phase 3 issue #23)"
```

---

## Task 9: Manual verification + roadmap tick

**Files:**

- Modify (optional): `README.md` — only if a "[ ] #23" or equivalent line exists in the roadmap.

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

Wait for `SANCTUM_READY` (the bumped 180s timeout from PR #25 covers cold start).

- [ ] **Step 2: Walk through the new UX with `agent-browser`**

From a separate shell (or mid-Claude-Code session):

```bash
agent-browser connect 9333
agent-browser snapshot -i
```

In the running app: open an existing OPEN session, then verify each row in this matrix:

| Action                                                | Expected                                                                                                                                                                                                                                          |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Click a pending detection in the document             | Sidebar row expands with operator dropdown + edit-replacement button + accept/reject buttons. Inline-preview span on that detection upgrades from faint to firm. Original gets struck through (`sanctum-previewing`).                             |
| Press <kbd>Enter</kbd> on the focused detection       | `actions.accept` fires; row's status flips to accepted; firm preview stays; focus auto-advances per existing keyboard map.                                                                                                                        |
| Press <kbd>Backspace</kbd> on the next pending        | `actions.reject` fires; row flips to rejected; **no inline preview shown**; original text reads verbatim with a muted background and **no line-through**.                                                                                         |
| Click "Edit replacement" on a pending row             | Operator dropdown is replaced by an input pre-filled with the existing custom replacement (or empty). <kbd>Enter</kbd> commits, <kbd>Esc</kbd> cancels.                                                                                           |
| Pick `pseudonymize` while the mapping store is locked | Hint "Unlock the mapping store before committing." appears under the dropdown. The Commit panel's existing block on `pseudonymize` still applies.                                                                                                 |
| Scan a paragraph with multiple pending detections     | Each unfocused pending detection shows the faint italic-mono preview floating after the original; only the focused one is firm.                                                                                                                   |
| No floating tooltip anywhere                          | Confirm by opening `agent-browser snapshot -i` — there should be no element with `data-testid="detection-tooltip"`.                                                                                                                               |
| Scroll a long document with many detections           | Inline-preview spans should reposition smoothly, no visible jank. (The spec flags `autoUpdate` cost as a risk worth checking — if scrolling stutters on a dense doc, file a follow-up to switch to an `IntersectionObserver`-driven layout pass.) |

- [ ] **Step 3: Tick the roadmap if applicable**

```bash
grep -n "issue-23\|issue #23\|#23\|Accept/Reject" README.md
```

If a roadmap checkbox exists for this work, flip `[ ]` → `[x]` and commit:

```bash
git add README.md
git commit -m "README: mark issue #23 done (Phase 3 issue #23)"
```

If no checkbox exists, skip this step.

- [ ] **Step 4: Push and request review**

```bash
git push
gh pr ready  # mark PR #26 ready for review
```

Verify the PR description still reflects the implementation (test plan should now have its boxes ticked).
