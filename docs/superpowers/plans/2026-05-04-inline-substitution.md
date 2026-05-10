# Inline Substitution on Accept — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `position: absolute` floating preview that overlays document text on Accept with real inline substitution: on Accept, the proposed replacement substitutes the original in document flow and surrounding text reflows around it. The proposed replacement is always visible in the sidebar so reviewers see the change before deciding.

**Architecture:** A new DOM-mutation pass (`wrapDetections` in `src/renderer/src/review/edit-wrap.ts`) wraps each resolved detection's `Range` in a `<span class="sanctum-edit"><span class="sanctum-edit-original">…</span></span>` — structure only, no styling. A new React component `EditReplacement` watches the review store and applies a pure helper `applyEditDecorations(root, detections, previews)` that (a) sets `data-status` on each wrapper based on the detection's status (only `"accepted"` when `previews[id]` is also present, else falls back to a non-substituting state), and (b) inserts a `<span class="sanctum-edit-replacement">…</span>` sibling inside each wrap. CSS handles the visual swap on `[data-status="accepted"]`. The old `sanctum-previewing` highlight registry, `InlinePreview` component, and `.inline-preview*` CSS are removed. `segments.ts`'s `TreeWalker` is taught to skip `.sanctum-edit-replacement` text so character-offset math survives the wrap.

**Tech Stack:** TypeScript strict, React 19, Vitest + happy-dom, CSS Custom Highlight API, DOM Range API.

**Reference spec:** `docs/superpowers/specs/2026-05-04-inline-substitution-design.md`.

**PR:** [#28](https://github.com/FilippoTonci/sanctum-desktop/pull/28) · **Issue:** [#27](https://github.com/FilippoTonci/sanctum-desktop/issues/27).

**Branch:** `fix/inline-substitution` (already pushed). Each Task below maps to one substep commit per the repo's CONTRIBUTING convention. Commit subjects use the form `<change> (issue #27)`. Do **not** use `--no-verify`; husky + lint-staged run prettier on every commit.

**Quality gates that must stay green at the end of every Task:**

- `npm run lint` (ESLint, `--max-warnings=0`)
- `npm run typecheck` (`tsc --build --force`)
- `npm test` (vitest unit lane)

Run them after each Task before committing.

---

### Task 1: Drop the `sanctum-previewing` highlight registry

The strikethrough-on-original treatment from the shipped design no longer fits — under the new model the original simply stops being visible when accepted, and stays untouched when pending/rejected.

**Files:**

- Modify: `src/renderer/src/review/highlights.ts`
- Modify: `src/renderer/src/index.css` (lines 931–936 — `::highlight(sanctum-previewing)` block)
- Modify: `tests/unit/renderer/highlights.test.ts` (lines 138–202 — `sanctum-previewing` describe block)

- [ ] **Step 1: Remove the previewing assertions in the existing test**

Delete the entire `describe('applyHighlightRegistries — sanctum-previewing', …)` block (lines 138–202) from `tests/unit/renderer/highlights.test.ts`. Keep the `installHighlightApi` helper above it — it'll still be needed if anyone adds a highlight test back later, and it's referenced inside the now-deleted block.

If `installHighlightApi` is not used by any remaining describe block, remove it too (a quick `grep installHighlightApi tests/unit/renderer/highlights.test.ts` after the delete will show 0 matches if so). At time of writing the helper is only used inside the deleted block, so it should be removed.

After this step the file contains only the `describe('resolveDetections', …)` and `describe('seedFakeDetections', …)` blocks.

- [ ] **Step 2: Run the test file to confirm it still passes**

Run: `npx vitest run tests/unit/renderer/highlights.test.ts`
Expected: PASS, with two describe blocks remaining.

- [ ] **Step 3: Edit `src/renderer/src/review/highlights.ts` to drop the registry**

Replace the file's current contents with:

```ts
/**
 * Drive the CSS Custom Highlight API from a list of detections.
 *
 * Four registries are maintained:
 *
 *   sanctum-pending   — detections the reviewer hasn't acted on
 *   sanctum-accepted  — detections the reviewer marked accept
 *   sanctum-rejected  — detections the reviewer marked reject
 *   sanctum-focused   — the single detection currently focused (overlay
 *                        on top of one of the three above)
 *
 * The CSS in `index.css` paints each registry. The renderer just owns
 * which Range goes into which registry on every state change.
 */

import { findSegmentRange } from './segments'
import type { Detection } from './types'

const REGISTRY_NAMES = {
  pending: 'sanctum-pending',
  accepted: 'sanctum-accepted',
  rejected: 'sanctum-rejected',
  focused: 'sanctum-focused',
} as const

type RegistryName = (typeof REGISTRY_NAMES)[keyof typeof REGISTRY_NAMES]

export interface ResolvedDetection {
  readonly detection: Detection
  readonly range: Range
}

/**
 * Resolve every detection to a DOM Range against `root`. Returns the
 * subset that hit (a detection whose run is not currently rendered is
 * silently dropped — common during async docx-preview render warmup).
 */
export function resolveDetections(
  root: ParentNode,
  detections: readonly Detection[],
): ResolvedDetection[] {
  const out: ResolvedDetection[] = []
  for (const detection of detections) {
    const range = findSegmentRange(root, {
      segmentId: detection.segmentId,
      start: detection.start,
      end: detection.end,
    })
    if (range !== null) out.push({ detection, range })
  }
  return out
}

/**
 * Push the resolved ranges into the four CSS Custom Highlight
 * registries. Idempotent — call this on every detection or focus
 * change. Returns `false` when the platform lacks Highlight API
 * support (older browsers, happy-dom under unit test); callers should
 * fall back to no-overlay mode in that case.
 */
export function applyHighlightRegistries(
  resolved: readonly ResolvedDetection[],
  focusedId: string | null,
): boolean {
  if (!hasHighlightApi()) return false

  const registry: Record<RegistryName, Highlight> = {
    [REGISTRY_NAMES.pending]: ensureRegistry(REGISTRY_NAMES.pending),
    [REGISTRY_NAMES.accepted]: ensureRegistry(REGISTRY_NAMES.accepted),
    [REGISTRY_NAMES.rejected]: ensureRegistry(REGISTRY_NAMES.rejected),
    [REGISTRY_NAMES.focused]: ensureRegistry(REGISTRY_NAMES.focused),
  }

  for (const name of Object.values(REGISTRY_NAMES)) {
    registry[name].clear()
  }

  for (const { detection, range } of resolved) {
    registry[REGISTRY_NAMES[detection.status]].add(range)
    if (detection.id === focusedId) {
      registry[REGISTRY_NAMES.focused].add(range)
    }
  }

  return true
}

function ensureRegistry(name: RegistryName): Highlight {
  const existing = CSS.highlights.get(name)
  if (existing !== undefined) return existing
  const created = new Highlight()
  CSS.highlights.set(name, created)
  return created
}

function hasHighlightApi(): boolean {
  return (
    typeof CSS !== 'undefined' &&
    typeof Highlight !== 'undefined' &&
    typeof CSS.highlights !== 'undefined'
  )
}
```

- [ ] **Step 4: Remove the `::highlight(sanctum-previewing)` CSS rule**

Open `src/renderer/src/index.css` and delete lines 931–936 (the block currently reading):

```css
::highlight(sanctum-previewing) {
  /* Strikethrough + faded ink on detections whose replacement is shown
     firmly (accepted, focused-pending). Pairs with .inline-preview-firm. */
  text-decoration: line-through rgba(124, 32, 24, 0.6);
  color: rgba(118, 107, 91, 0.78);
}
```

Leave the four blocks above it (`sanctum-pending`, `sanctum-accepted`, `sanctum-rejected`, `sanctum-focused`) intact.

- [ ] **Step 5: Run the full quality gate**

Run: `npm run lint && npm run typecheck && npm test`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/review/highlights.ts \
        src/renderer/src/index.css \
        tests/unit/renderer/highlights.test.ts
git commit -m "Drop sanctum-previewing highlight registry (issue #27)"
```

---

### Task 2: Add the `edit-wrap` module + CSS scaffolding

The structural wrap. `wrapDetections` mutates the docx body once per resolve to put each detection's text inside `<span class="sanctum-edit"><span class="sanctum-edit-original">…</span></span>`. `unwrapAll` reverses it. The CSS rules added here describe the substitution mechanism without using it yet — `EditReplacement` (Task 4) supplies the `data-status="accepted"` toggle and the replacement DOM.

**Files:**

- Create: `src/renderer/src/review/edit-wrap.ts`
- Create: `tests/unit/renderer/edit-wrap.test.ts`
- Modify: `src/renderer/src/index.css` (append a new block before the existing `.inline-preview` block at line 1882)

- [ ] **Step 1: Write the failing test file**

Create `tests/unit/renderer/edit-wrap.test.ts`:

```ts
// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { unwrapAll, wrapDetections } from '../../../src/renderer/src/review/edit-wrap'
import { resolveDetections } from '../../../src/renderer/src/review/highlights'
import type { Detection } from '../../../src/renderer/src/review/types'

function setBody(html: string): HTMLElement {
  document.body.innerHTML = html
  return document.body
}

function detection(over: Partial<Detection>): Detection {
  return {
    id: 'd0',
    segmentId: 'body/p0/r0',
    start: 0,
    end: 5,
    text: 'Alice',
    entityType: 'PERSON',
    status: 'pending',
    ...over,
  }
}

describe('wrapDetections', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('wraps each resolved detection in a .sanctum-edit > .sanctum-edit-original pair', () => {
    const root = setBody('<p><span data-segment-id="body/p0/r0">Alice met Bob today.</span></p>')
    const dets: Detection[] = [
      detection({ id: 'a', start: 0, end: 5, text: 'Alice' }),
      detection({ id: 'b', start: 10, end: 13, text: 'Bob' }),
    ]
    const resolved = resolveDetections(root, dets)
    wrapDetections(root, resolved)

    const wraps = root.querySelectorAll('.sanctum-edit')
    expect(wraps).toHaveLength(2)
    const a = root.querySelector<HTMLElement>('.sanctum-edit[data-detection-id="a"]')
    const b = root.querySelector<HTMLElement>('.sanctum-edit[data-detection-id="b"]')
    expect(a?.querySelector('.sanctum-edit-original')?.textContent).toBe('Alice')
    expect(b?.querySelector('.sanctum-edit-original')?.textContent).toBe('Bob')
  })

  it('is idempotent — a second call with the same resolved set leaves wraps in place', () => {
    const root = setBody('<p><span data-segment-id="body/p0/r0">Alice met Bob.</span></p>')
    const dets: Detection[] = [
      detection({ id: 'a', start: 0, end: 5 }),
      detection({ id: 'b', start: 10, end: 13 }),
    ]
    wrapDetections(root, resolveDetections(root, dets))
    const firstA = root.querySelector('.sanctum-edit[data-detection-id="a"]')
    wrapDetections(root, resolveDetections(root, dets))
    const secondA = root.querySelector('.sanctum-edit[data-detection-id="a"]')
    // Same node identity proves we didn't re-wrap.
    expect(secondA).toBe(firstA)
    expect(root.querySelectorAll('.sanctum-edit')).toHaveLength(2)
  })

  it('unwraps detections that disappear from the resolved set', () => {
    const root = setBody('<p><span data-segment-id="body/p0/r0">Alice met Bob.</span></p>')
    const both: Detection[] = [
      detection({ id: 'a', start: 0, end: 5 }),
      detection({ id: 'b', start: 10, end: 13 }),
    ]
    wrapDetections(root, resolveDetections(root, both))
    expect(root.querySelectorAll('.sanctum-edit')).toHaveLength(2)

    const onlyA: Detection[] = [detection({ id: 'a', start: 0, end: 5 })]
    wrapDetections(root, resolveDetections(root, onlyA))
    expect(root.querySelectorAll('.sanctum-edit')).toHaveLength(1)
    expect(root.querySelector('.sanctum-edit[data-detection-id="a"]')).not.toBeNull()
    expect(root.querySelector('.sanctum-edit[data-detection-id="b"]')).toBeNull()
    // Bob's text survived in the document.
    expect(root.textContent).toContain('Bob')
  })

  it('skips detections whose range straddles element boundaries without throwing', () => {
    const root = setBody('<p><span data-segment-id="body/p0/r0">Alice <b>and</b> Bob.</span></p>')
    // Span "Alice and" — crosses the <b> boundary (text node "Alice " then <b>and</b>).
    const dets: Detection[] = [detection({ id: 'crossing', start: 0, end: 9, text: 'Alice and' })]
    const resolved = resolveDetections(root, dets)
    expect(() => {
      wrapDetections(root, resolved)
    }).not.toThrow()
    expect(root.querySelector('.sanctum-edit[data-detection-id="crossing"]')).toBeNull()
    // Untouched, original text intact.
    expect(root.textContent).toContain('Alice and Bob.')
  })
})

describe('unwrapAll', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('removes every .sanctum-edit wrapper, leaving the original text in place', () => {
    const root = setBody('<p><span data-segment-id="body/p0/r0">Alice and Bob.</span></p>')
    const dets: Detection[] = [
      detection({ id: 'a', start: 0, end: 5 }),
      detection({ id: 'b', start: 10, end: 13 }),
    ]
    wrapDetections(root, resolveDetections(root, dets))
    expect(root.querySelectorAll('.sanctum-edit')).toHaveLength(2)

    unwrapAll(root)
    expect(root.querySelectorAll('.sanctum-edit')).toHaveLength(0)
    expect(root.textContent).toContain('Alice and Bob.')
  })
})
```

- [ ] **Step 2: Run the test file to verify it fails**

Run: `npx vitest run tests/unit/renderer/edit-wrap.test.ts`
Expected: FAIL with module-not-found error for `'../../../src/renderer/src/review/edit-wrap'`.

- [ ] **Step 3: Create the module**

Create `src/renderer/src/review/edit-wrap.ts`:

```ts
/**
 * DOM-mutation pass that wraps each resolved detection's Range in
 *
 *   <span class="sanctum-edit" data-detection-id="…">
 *     <span class="sanctum-edit-original">{originalText}</span>
 *   </span>
 *
 * The wrap is structure-only — it does not set the `data-status`
 * attribute. EditReplacement (in src/renderer/src/components/) reacts
 * to store changes, sets data-status on each wrapper, and inserts a
 * sibling .sanctum-edit-replacement when a preview is available.
 *
 * The wrap survives subsequent resolve passes: wrapDetections is
 * idempotent — wrapped detections are skipped, and any wraps whose
 * detection id is no longer in the resolved set are unwrapped.
 *
 * Detections whose Range crosses element boundaries (e.g. straddling
 * a <b>) cannot be wrapped via Range.surroundContents — those throw
 * InvalidStateError, which we catch and skip. The highlight registries
 * still paint over the cross-boundary range, the sidebar still carries
 * the proposed replacement, and Accept still records the decision; only
 * the in-document substitution is unavailable for those detections.
 */

import type { ResolvedDetection } from './highlights'

const EDIT_CLASS = 'sanctum-edit'
const ORIGINAL_CLASS = 'sanctum-edit-original'
const DATA_DETECTION_ID = 'data-detection-id'

/**
 * Wrap each resolved detection in a `.sanctum-edit` span.
 * Idempotent: existing wraps with matching detection ids are left alone,
 * and stale wraps (id not in `resolved`) are unwrapped.
 */
export function wrapDetections(root: ParentNode, resolved: readonly ResolvedDetection[]): void {
  const wantedIds = new Set(resolved.map(({ detection }) => detection.id))

  // Unwrap stale wraps first — clears the way for fresh ones.
  const existing = root.querySelectorAll<HTMLElement>(`.${EDIT_CLASS}[${DATA_DETECTION_ID}]`)
  for (const wrap of existing) {
    const id = wrap.getAttribute(DATA_DETECTION_ID)
    if (id !== null && !wantedIds.has(id)) {
      unwrapOne(wrap)
    }
  }

  // Wrap any detection that doesn't yet have one.
  for (const { detection, range } of resolved) {
    if (
      root.querySelector(`.${EDIT_CLASS}[${DATA_DETECTION_ID}="${escapeAttr(detection.id)}"]`) !==
      null
    ) {
      continue
    }

    const ownerDoc = ownerDocumentOf(root)
    if (ownerDoc === null) continue

    const outer = ownerDoc.createElement('span')
    outer.className = EDIT_CLASS
    outer.setAttribute(DATA_DETECTION_ID, detection.id)

    try {
      range.surroundContents(outer)
    } catch {
      // Range.surroundContents throws InvalidStateError when the range
      // straddles element boundaries. Skip — see module-level JSDoc.
      continue
    }

    // Move the wrapped contents into a child .sanctum-edit-original so
    // CSS can hide them via [data-status="accepted"] without touching
    // the replacement sibling that EditReplacement will add.
    const inner = ownerDoc.createElement('span')
    inner.className = ORIGINAL_CLASS
    while (outer.firstChild !== null) {
      inner.appendChild(outer.firstChild)
    }
    outer.appendChild(inner)
  }
}

/**
 * Remove every `.sanctum-edit` wrapper inside `root`, restoring the
 * original text nodes in their place. Used on full teardown (e.g.
 * before re-rendering the docx).
 */
export function unwrapAll(root: ParentNode): void {
  const wraps = root.querySelectorAll<HTMLElement>(`.${EDIT_CLASS}`)
  for (const wrap of wraps) {
    unwrapOne(wrap)
  }
}

function unwrapOne(outer: HTMLElement): void {
  const parent = outer.parentNode
  if (parent === null) return
  const inner = outer.querySelector<HTMLElement>(`:scope > .${ORIGINAL_CLASS}`)
  if (inner !== null) {
    while (inner.firstChild !== null) {
      parent.insertBefore(inner.firstChild, outer)
    }
  }
  parent.removeChild(outer)
}

function ownerDocumentOf(root: ParentNode): Document | null {
  if (root instanceof Document) return root
  if (root instanceof Element) return root.ownerDocument
  if (root instanceof DocumentFragment) return root.ownerDocument
  return null
}

/**
 * Escape an attribute value for inclusion in a CSS attribute selector.
 * Detection ids today are URL-safe, but the contract is open-ended,
 * matching the same defensive escape `findSegmentElement` uses.
 */
function escapeAttr(value: string): string {
  return value.replace(/["\\]/g, (m) => `\\${m}`)
}
```

- [ ] **Step 4: Run the test file to verify it passes**

Run: `npx vitest run tests/unit/renderer/edit-wrap.test.ts`
Expected: PASS, all five tests green.

- [ ] **Step 5: Append the CSS scaffolding**

Open `src/renderer/src/index.css`. Find the section header `Inline preview — replacement text floated next to each detection.` (around line 1882). Insert a new section **before** it:

```css
/* =========================================================================
   Inline edit substitution — wraps emitted by review/edit-wrap.ts.
   See: docs/superpowers/specs/2026-05-04-inline-substitution-design.md
   ========================================================================= */

.sanctum-edit {
  /* Layout no-op — surrounds the original text in document flow. */
  display: inline;
}

.sanctum-edit-original {
  display: inline;
}

.sanctum-edit-replacement {
  /* Hidden by default; shown only when the wrap reaches accepted state
     AND a replacement is available (data-status set by EditReplacement). */
  display: none;
  font-family: var(--font-mono);
  font-style: italic;
  font-size: 0.92em;
  font-weight: 500;
  color: var(--oxblood);
}

.sanctum-edit[data-status='accepted'] .sanctum-edit-original {
  display: none;
}

.sanctum-edit[data-status='accepted'] .sanctum-edit-replacement {
  display: inline;
}
```

(The existing `.inline-preview` and `.inline-preview-firm` blocks stay for now — Task 5 deletes them once nothing references them.)

- [ ] **Step 6: Run the full quality gate**

Run: `npm run lint && npm run typecheck && npm test`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/review/edit-wrap.ts \
        tests/unit/renderer/edit-wrap.test.ts \
        src/renderer/src/index.css
git commit -m "Add edit-wrap module + CSS scaffolding (issue #27)"
```

---

### Task 3: Teach `segments.ts` to ignore `.sanctum-edit-replacement`

After Task 4 lands, the run element will contain both the original text node (now nested inside `.sanctum-edit-original`) and a sibling `.sanctum-edit-replacement` carrying the substituted text. The `TreeWalker(SHOW_TEXT)` inside `rangeWithinElement` and `textOffsetWithin` would otherwise count replacement characters in offset math and break the (segmentId, start, end) contract.

**Files:**

- Modify: `src/renderer/src/review/segments.ts` (lines 53–92, 153–180)
- Modify: `tests/unit/renderer/segments.test.ts` (append a new describe block)

- [ ] **Step 1: Add the failing test**

Append at the bottom of `tests/unit/renderer/segments.test.ts`:

```ts
describe('findSegmentRange — replacement-aware walker', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('ignores .sanctum-edit-replacement text when computing offsets', () => {
    // Mimics the post-wrap DOM state: original text inside
    // .sanctum-edit-original, replacement inside a sibling span.
    const root = setBody(
      '<span data-segment-id="body/p0/r0">' +
        'Alice met ' +
        '<span class="sanctum-edit" data-detection-id="b">' +
        '<span class="sanctum-edit-original">Bob</span>' +
        '<span class="sanctum-edit-replacement">[PERSON_001]</span>' +
        '</span>' +
        ' today.' +
        '</span>',
    )
    // Original textContent of the segment: "Alice met Bob today."
    //                                       0         1         2
    //                                       0123456789012345678901
    // "Bob" starts at 10, ends at 13.
    const range = findSegmentRange(root, { segmentId: 'body/p0/r0', start: 10, end: 13 })
    expect(range?.toString()).toBe('Bob')

    // And "today" starts at 14, ends at 19 — the walker must skip the
    // replacement span when counting characters.
    const todayRange = findSegmentRange(root, { segmentId: 'body/p0/r0', start: 14, end: 19 })
    expect(todayRange?.toString()).toBe('today')
  })
})
```

- [ ] **Step 2: Run the test file to verify the new test fails**

Run: `npx vitest run tests/unit/renderer/segments.test.ts`
Expected: the new describe block FAILs (the walker still counts replacement chars). Existing tests still pass.

- [ ] **Step 3: Patch the walker**

Edit `src/renderer/src/review/segments.ts`. Replace the `rangeWithinElement` function (currently lines 53–92) with:

```ts
export function rangeWithinElement(el: Element, start: number, end: number): Range | null {
  if (start < 0 || end < start) return null

  const doc = el.ownerDocument
  const walker = createSegmentTextWalker(doc, el)

  let consumed = 0
  let startNode: Text | null = null
  let startOffset = 0
  let endNode: Text | null = null
  let endOffset = 0

  for (
    let node = walker.nextNode() as Text | null;
    node !== null;
    node = walker.nextNode() as Text | null
  ) {
    const len = node.data.length
    const nodeStart = consumed
    const nodeEnd = consumed + len

    if (startNode === null && start <= nodeEnd) {
      startNode = node
      startOffset = Math.max(0, start - nodeStart)
    }
    if (end <= nodeEnd) {
      endNode = node
      endOffset = end - nodeStart
      break
    }
    consumed = nodeEnd
  }

  if (startNode === null || endNode === null) return null

  const range = doc.createRange()
  range.setStart(startNode, startOffset)
  range.setEnd(endNode, endOffset)
  return range
}
```

Replace the `textOffsetWithin` function (currently lines 153–180) with:

```ts
function textOffsetWithin(host: Element, target: Node, targetOffset: number): number | null {
  const doc = host.ownerDocument
  const walker = createSegmentTextWalker(doc, host)
  let consumed = 0
  for (
    let node = walker.nextNode() as Text | null;
    node !== null;
    node = walker.nextNode() as Text | null
  ) {
    if (node === target) return consumed + targetOffset
    consumed += node.data.length
  }
  // Caller passed a target that is not a descendant of host, or is an
  // element node: treat the offset as positions within child nodes.
  if (target instanceof Element && target === host) {
    let acc = 0
    const childWalker = createSegmentTextWalker(doc, host)
    let child = childWalker.nextNode() as Text | null
    let i = 0
    while (child !== null && i < targetOffset) {
      acc += child.data.length
      child = childWalker.nextNode() as Text | null
      i++
    }
    return acc
  }
  return null
}
```

Then add a new helper near the bottom of the file (before the closing brace of the last function):

```ts
/**
 * Build a TreeWalker that visits every text node inside `host` *except*
 * those inside `.sanctum-edit-replacement`. The replacement spans hold
 * substituted text rendered by EditReplacement; including their
 * characters in offset math would invalidate the (segmentId, start, end)
 * contract on subsequent resolves. See the design spec.
 */
function createSegmentTextWalker(doc: Document, host: Element): TreeWalker {
  return doc.createTreeWalker(host, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      let parent: Node | null = node.parentNode
      while (parent !== null && parent !== host) {
        if (parent instanceof Element && parent.classList.contains('sanctum-edit-replacement')) {
          return NodeFilter.FILTER_REJECT
        }
        parent = parent.parentNode
      }
      return NodeFilter.FILTER_ACCEPT
    },
  })
}
```

- [ ] **Step 4: Run the test file to verify the new test passes**

Run: `npx vitest run tests/unit/renderer/segments.test.ts`
Expected: PASS, all describe blocks green.

- [ ] **Step 5: Run the full quality gate**

Run: `npm run lint && npm run typecheck && npm test`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/review/segments.ts tests/unit/renderer/segments.test.ts
git commit -m "Skip .sanctum-edit-replacement text in segment walker (issue #27)"
```

---

### Task 4: Add `EditReplacement` component + `applyEditDecorations` helper

`applyEditDecorations(root, detections, previews)` is a pure DOM-mutation helper that walks every `.sanctum-edit` wrapper and (a) sets `data-status` on it, only marking `accepted` when a preview is available, and (b) inserts/updates/removes the `.sanctum-edit-replacement` sibling inside it. `EditReplacement` is a tiny React component that calls the helper from a `useEffect` keyed on the latest store state.

**Files:**

- Create: `src/renderer/src/components/EditReplacement.tsx`
- Create: `tests/unit/renderer/edit-replacement.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/renderer/edit-replacement.test.ts`:

```ts
// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { applyEditDecorations } from '../../../src/renderer/src/components/EditReplacement'
import type { Detection } from '../../../src/renderer/src/review/types'

function setBody(html: string): HTMLElement {
  document.body.innerHTML = html
  return document.body
}

function detection(over: Partial<Detection>): Detection {
  return {
    id: 'd0',
    segmentId: 'body/p0/r0',
    start: 0,
    end: 5,
    text: 'Alice',
    entityType: 'PERSON',
    status: 'pending',
    ...over,
  }
}

function wrapped(id: string, originalText: string): string {
  return (
    `<span class="sanctum-edit" data-detection-id="${id}">` +
    `<span class="sanctum-edit-original">${originalText}</span>` +
    `</span>`
  )
}

describe('applyEditDecorations', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('inserts a .sanctum-edit-replacement inside each wrap whose detection has a preview', () => {
    const root = setBody(`<p>${wrapped('a', 'Alice')} met ${wrapped('b', 'Bob')}.</p>`)
    applyEditDecorations(
      root,
      [detection({ id: 'a', text: 'Alice' }), detection({ id: 'b', text: 'Bob' })],
      { a: '[PERSON_001]', b: '[PERSON_002]' },
    )

    const replacements = root.querySelectorAll('.sanctum-edit-replacement')
    expect(replacements).toHaveLength(2)
    const a = root.querySelector('.sanctum-edit[data-detection-id="a"] .sanctum-edit-replacement')
    const b = root.querySelector('.sanctum-edit[data-detection-id="b"] .sanctum-edit-replacement')
    expect(a?.textContent).toBe('[PERSON_001]')
    expect(b?.textContent).toBe('[PERSON_002]')
  })

  it('omits the replacement DOM for detections without a preview', () => {
    const root = setBody(`<p>${wrapped('a', 'Alice')}</p>`)
    applyEditDecorations(root, [detection({ id: 'a', text: 'Alice' })], {})
    expect(root.querySelector('.sanctum-edit-replacement')).toBeNull()
  })

  it('only sets data-status="accepted" when both status=accepted AND a preview is present', () => {
    const root = setBody(`<p>${wrapped('a', 'A')}${wrapped('b', 'B')}${wrapped('c', 'C')}</p>`)
    applyEditDecorations(
      root,
      [
        detection({ id: 'a', status: 'accepted', text: 'A' }),
        detection({ id: 'b', status: 'accepted', text: 'B' }),
        detection({ id: 'c', status: 'pending', text: 'C' }),
      ],
      { a: '<X>', /* b has no preview */ c: '<Z>' },
    )
    const a = root.querySelector<HTMLElement>('.sanctum-edit[data-detection-id="a"]')
    const b = root.querySelector<HTMLElement>('.sanctum-edit[data-detection-id="b"]')
    const c = root.querySelector<HTMLElement>('.sanctum-edit[data-detection-id="c"]')
    expect(a?.dataset.status).toBe('accepted')
    expect(b?.dataset.status).not.toBe('accepted')
    expect(c?.dataset.status).not.toBe('accepted')
  })

  it('updates an existing replacement when the preview text changes', () => {
    const root = setBody(`<p>${wrapped('a', 'Alice')}</p>`)
    applyEditDecorations(root, [detection({ id: 'a' })], { a: 'first' })
    expect(root.querySelector('.sanctum-edit-replacement')?.textContent).toBe('first')
    applyEditDecorations(root, [detection({ id: 'a' })], { a: 'second' })
    const replacements = root.querySelectorAll('.sanctum-edit-replacement')
    expect(replacements).toHaveLength(1)
    expect(replacements[0]?.textContent).toBe('second')
  })

  it('removes a replacement when the preview disappears', () => {
    const root = setBody(`<p>${wrapped('a', 'Alice')}</p>`)
    applyEditDecorations(root, [detection({ id: 'a' })], { a: 'one' })
    applyEditDecorations(root, [detection({ id: 'a' })], {})
    expect(root.querySelector('.sanctum-edit-replacement')).toBeNull()
  })

  it('flips data-status back when un-accepted', () => {
    const root = setBody(`<p>${wrapped('a', 'Alice')}</p>`)
    applyEditDecorations(root, [detection({ id: 'a', status: 'accepted' })], { a: '<X>' })
    const wrap = root.querySelector<HTMLElement>('.sanctum-edit[data-detection-id="a"]')
    expect(wrap?.dataset.status).toBe('accepted')

    applyEditDecorations(root, [detection({ id: 'a', status: 'pending' })], { a: '<X>' })
    expect(wrap?.dataset.status).not.toBe('accepted')
  })
})
```

- [ ] **Step 2: Run the test file to verify it fails**

Run: `npx vitest run tests/unit/renderer/edit-replacement.test.ts`
Expected: FAIL with module-not-found error.

- [ ] **Step 3: Create the component**

Create `src/renderer/src/components/EditReplacement.tsx`:

```tsx
import { useEffect, type ReactElement } from 'react'
import { useReviewStore } from '../review/store'
import type { Detection } from '../review/types'

interface EditReplacementProps {
  /** The DocxView body element where wraps were emitted. */
  readonly anchorRoot: HTMLElement | null
}

/**
 * Reacts to store changes and decorates the `.sanctum-edit` wrappers
 * (emitted by review/edit-wrap.ts) with per-detection state:
 *
 *   - sets data-status on each wrap (only `accepted` when a preview is
 *     also available, so the original keeps showing if the backend
 *     hasn't supplied a replacement yet)
 *   - inserts/updates/removes a sibling `.sanctum-edit-replacement`
 *     inside each wrap, holding the proposed replacement text
 *
 * Visual swap is pure CSS (`[data-status="accepted"]` rules in
 * index.css). This component renders no DOM of its own.
 */
export function EditReplacement({ anchorRoot }: EditReplacementProps): ReactElement | null {
  const detections = useReviewStore((s) => s.detections)
  const previews = useReviewStore((s) => s.previews)

  useEffect(() => {
    if (anchorRoot === null) return
    applyEditDecorations(anchorRoot, detections, previews)
  }, [anchorRoot, detections, previews])

  return null
}

const EDIT_SELECTOR = '.sanctum-edit'
const REPLACEMENT_CLASS = 'sanctum-edit-replacement'

/**
 * Pure DOM mutation that drives the visual state of every
 * `.sanctum-edit` wrap inside `root`. Idempotent — call again with
 * fresh inputs to update.
 *
 * Exported for unit testing alongside the React component.
 */
export function applyEditDecorations(
  root: ParentNode,
  detections: readonly Detection[],
  previews: Readonly<Record<string, string>>,
): void {
  const byId = new Map<string, Detection>()
  for (const d of detections) byId.set(d.id, d)

  const wraps = root.querySelectorAll<HTMLElement>(EDIT_SELECTOR)
  for (const wrap of wraps) {
    const id = wrap.dataset.detectionId
    if (id === undefined) continue
    const detection = byId.get(id)
    const preview = previews[id]

    // data-status: only "accepted" when both the detection is accepted
    // AND a preview is available. Otherwise the wrap keeps the original
    // visible regardless of decision (matches the design spec's
    // standalone-fake / preview-not-yet-loaded fallback).
    if (detection !== undefined && detection.status === 'accepted' && preview !== undefined) {
      wrap.dataset.status = 'accepted'
    } else {
      delete wrap.dataset.status
    }

    // Replacement DOM: present iff a preview exists for this id.
    let replacement = wrap.querySelector<HTMLElement>(`:scope > .${REPLACEMENT_CLASS}`)
    if (preview === undefined) {
      replacement?.remove()
      continue
    }
    if (replacement === null) {
      const ownerDoc = wrap.ownerDocument
      replacement = ownerDoc.createElement('span')
      replacement.className = REPLACEMENT_CLASS
      wrap.appendChild(replacement)
    }
    if (replacement.textContent !== preview) {
      replacement.textContent = preview
    }
  }
}
```

- [ ] **Step 4: Run the test file to verify it passes**

Run: `npx vitest run tests/unit/renderer/edit-replacement.test.ts`
Expected: PASS, all six tests green.

- [ ] **Step 5: Run the full quality gate**

Run: `npm run lint && npm run typecheck && npm test`
Expected: all PASS. (`EditReplacement` isn't wired into App yet — Task 5 — so no lints about an unused import will appear in the existing surface.)

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/EditReplacement.tsx \
        tests/unit/renderer/edit-replacement.test.ts
git commit -m "Add EditReplacement component + applyEditDecorations (issue #27)"
```

---

### Task 5: Wire wrap + EditReplacement; remove `InlinePreview`

Make `DocxView` call `wrapDetections` after `applyHighlightRegistries`. Replace `<InlinePreview>` in `App.tsx` with `<EditReplacement>`. Delete the now-unused `InlinePreview.tsx`, its test, and the `.inline-preview*` CSS blocks.

**Files:**

- Modify: `src/renderer/src/components/DocxView.tsx` (lines 3, 63–69)
- Modify: `src/renderer/src/App.tsx` (line 9, 312)
- Delete: `src/renderer/src/components/InlinePreview.tsx`
- Delete: `tests/unit/renderer/inline-preview.test.ts`
- Modify: `src/renderer/src/index.css` (delete `.inline-preview*` blocks at lines 1882–1920)

- [ ] **Step 1: Wire `wrapDetections` into `DocxView`**

Open `src/renderer/src/components/DocxView.tsx`. Replace the import line (line 3):

```ts
import { applyHighlightRegistries, resolveDetections } from '../review/highlights'
```

with:

```ts
import { applyHighlightRegistries, resolveDetections } from '../review/highlights'
import { wrapDetections } from '../review/edit-wrap'
```

Replace the resolve effect body (lines 63–69):

```ts
useEffect(() => {
  if (state.kind !== 'ready') return
  const host = bodyRef.current
  if (host === null) return
  const resolved = resolveDetections(host, detections)
  applyHighlightRegistries(resolved, focusedId)
}, [state.kind, detections, focusedId])
```

with:

```ts
useEffect(() => {
  if (state.kind !== 'ready') return
  const host = bodyRef.current
  if (host === null) return
  const resolved = resolveDetections(host, detections)
  applyHighlightRegistries(resolved, focusedId)
  wrapDetections(host, resolved)
}, [state.kind, detections, focusedId])
```

- [ ] **Step 2: Swap `InlinePreview` for `EditReplacement` in App.tsx**

In `src/renderer/src/App.tsx`, replace the import on line 9:

```ts
import { InlinePreview } from './components/InlinePreview'
```

with:

```ts
import { EditReplacement } from './components/EditReplacement'
```

Replace the JSX usage (around line 312):

```tsx
<InlinePreview anchorRoot={docRoot} />
```

with:

```tsx
<EditReplacement anchorRoot={docRoot} />
```

- [ ] **Step 3: Delete the old component + test**

```bash
rm src/renderer/src/components/InlinePreview.tsx tests/unit/renderer/inline-preview.test.ts
```

- [ ] **Step 4: Drop the `.inline-preview*` CSS blocks**

In `src/renderer/src/index.css`, delete the section header comment (currently around line 1882) and the two blocks below it through the closing `}` of the dark-mode media query (currently around line 1920). The block to remove looks like:

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

After this edit the inline-edit substitution block from Task 2 is the last visual layer in the file. Save and continue.

- [ ] **Step 5: Verify nothing references the deleted symbol**

Run: `grep -rn "InlinePreview\|inline-preview" src/renderer/src/`
Expected: no matches inside `src/renderer/src/`. (The design spec / plan markdown under `docs/` will still mention it — that's fine.)

- [ ] **Step 6: Run the full quality gate**

Run: `npm run lint && npm run typecheck && npm test`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/DocxView.tsx \
        src/renderer/src/App.tsx \
        src/renderer/src/index.css
git add -u  # picks up the deletions of InlinePreview.tsx + inline-preview.test.ts
git commit -m "Wire wrap + EditReplacement, drop InlinePreview (issue #27)"
```

---

### Task 6: Sidebar — show the proposed replacement under each row

Now that the document only swaps to the replacement _after_ Accept, the sidebar is the only place a reviewer sees the proposed replacement _before_ deciding. Add a `→ replacement` line to every row whose detection has a preview, with a status-driven emphasis tier.

**Files:**

- Modify: `src/renderer/src/components/DetectionSidebar.tsx`
- Modify: `tests/unit/renderer/detection-sidebar.test.ts`
- Modify: `src/renderer/src/index.css` (append to the existing sidebar item styles)

- [ ] **Step 1: Add the pure-helper test for the new field**

A new helper `pickReplacementVariant(detection, preview)` decides which CSS tier the replacement line uses, mirroring the pattern of `pickFocusedControlsState` already in this file. Append at the bottom of `tests/unit/renderer/detection-sidebar.test.ts`:

```ts
import { pickReplacementVariant } from '../../../src/renderer/src/components/DetectionSidebar'

describe('pickReplacementVariant', () => {
  it('returns null when no preview is available', () => {
    expect(pickReplacementVariant(detection({ status: 'pending' }), undefined)).toBeNull()
    expect(pickReplacementVariant(detection({ status: 'accepted' }), undefined)).toBeNull()
  })

  it('returns "firm" for accepted detections with a preview', () => {
    expect(pickReplacementVariant(detection({ status: 'accepted' }), '<X>')).toBe('firm')
  })

  it('returns "muted" for rejected detections with a preview', () => {
    expect(pickReplacementVariant(detection({ status: 'rejected' }), '<X>')).toBe('muted')
  })

  it('returns "faint" for pending detections with a preview', () => {
    expect(pickReplacementVariant(detection({ status: 'pending' }), '<X>')).toBe('faint')
  })
})
```

- [ ] **Step 2: Run the test file to verify the new tests fail**

Run: `npx vitest run tests/unit/renderer/detection-sidebar.test.ts`
Expected: the four `pickReplacementVariant` tests FAIL (export missing). Existing `pickFocusedControlsState` tests still pass.

- [ ] **Step 3: Add the helper + render the replacement line**

Open `src/renderer/src/components/DetectionSidebar.tsx`.

a) Just below `pickFocusedControlsState` (around line 46), add:

```ts
export type ReplacementVariant = 'firm' | 'faint' | 'muted'

/**
 * Decide the visual tier for the sidebar's "→ replacement" line:
 *
 *   accepted → firm   (the decision is made; the replacement matters)
 *   rejected → muted  (greyed; user opted out, replacement is now history)
 *   pending  → faint  (preview hint, not yet decided)
 *
 * Returns `null` when there's no preview to render.
 */
export function pickReplacementVariant(
  detection: Detection,
  preview: string | undefined,
): ReplacementVariant | null {
  if (preview === undefined) return null
  if (detection.status === 'accepted') return 'firm'
  if (detection.status === 'rejected') return 'muted'
  return 'faint'
}
```

b) In the `DetectionSidebar` component, add a hook read for previews. Find the line:

```ts
const editingReplacementId = useReviewStore((s) => s.editingReplacementId)
```

and add directly below it:

```ts
const previews = useReviewStore((s) => s.previews)
```

c) In the `<ul>` mapping, render the new line. Find the existing `<button …>` block:

```tsx
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
```

Replace it with:

```tsx
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
  {(() => {
    const variant = pickReplacementVariant(d, previews[d.id])
    if (variant === null) return null
    return (
      <span
        className={`sidebar-item-replacement sidebar-item-replacement-${variant}`}
        data-testid="sidebar-replacement"
      >
        → {previews[d.id]}
      </span>
    )
  })()}
  <span className="sidebar-item-meta">
    <span className="sidebar-item-entity">{d.entityType}</span>
    <span className={`sidebar-item-status sidebar-item-status-${d.status}`}>
      {STATUS_LABEL[d.status]}
    </span>
  </span>
</button>
```

- [ ] **Step 4: Run the test file to verify the new tests pass**

Run: `npx vitest run tests/unit/renderer/detection-sidebar.test.ts`
Expected: PASS, every describe block green.

- [ ] **Step 5: Style the replacement line**

Open `src/renderer/src/index.css`. Find the existing sidebar item styles (search for `.sidebar-item-text`). After that block, append:

```css
.sidebar-item-replacement {
  display: block;
  margin-top: 0.18rem;
  font-family: var(--font-mono);
  font-style: italic;
  font-size: 0.78rem;
  letter-spacing: 0.02em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--oxblood);
}

.sidebar-item-replacement-firm {
  opacity: 1;
  font-weight: 500;
}

.sidebar-item-replacement-faint {
  opacity: 0.65;
}

.sidebar-item-replacement-muted {
  opacity: 0.45;
  color: var(--ink-muted, #766b5b);
  text-decoration: line-through;
}

@media (prefers-color-scheme: dark) {
  .sidebar-item-replacement {
    color: var(--oxblood);
  }
  .sidebar-item-replacement-faint {
    opacity: 0.7;
  }
}
```

(`--ink-muted` is the token already used elsewhere in `index.css` for greyed-out body text. If a `grep` shows it isn't actually defined in `:root`, fall back to a literal `#766b5b` and remove the `var()`.)

- [ ] **Step 6: Run the full quality gate**

Run: `npm run lint && npm run typecheck && npm test`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/DetectionSidebar.tsx \
        tests/unit/renderer/detection-sidebar.test.ts \
        src/renderer/src/index.css
git commit -m "Show proposed replacement under each sidebar row (issue #27)"
```

---

### Task 7: Update README roadmap; manual smoke test

Tick the relevant boxes in `README.md` and run a manual smoke test against `npm run dev` to confirm reflow + sidebar behaviour matches the spec.

**Files:**

- Modify: `README.md` (status callout near the top + roadmap items relating to issue #23 / accept-reject)

- [ ] **Step 1: Update README**

Open `README.md`. Find the status callout near the top (look for "WS" markers or recent issue-23 mentions). If a roadmap line already covers the original Accept/Reject UX redesign with `[x]`, add a new sub-line under it like:

```md
- [x] Inline substitution on accept (issue #27) — replaces the floating preview overlay with real DOM substitution; document reflows around accepted replacements.
```

If there's no clean spot, append the line under the most recent UX-related entry. Keep the surrounding tone and indentation consistent with neighbouring items.

- [ ] **Step 2: Manual smoke test**

Run: `npm run dev`

Confirm by opening the dev window:

1. Drop a docx with a few paragraphs containing names / emails. The sidebar should populate; each row shows the original text plus a faint `→ <REPLACEMENT>` line below it.
2. Arrow-key down to a detection. Oxblood outline appears, controls expand. The document still shows the original text — no preview overlay anywhere on the page.
3. Press Enter (Accept). The original text in the document swaps to the replacement; the surrounding paragraph reflows. The sidebar row turns verdigris and the `→` line goes firm.
4. Arrow back to that row and press Backspace (Reject / un-accept). The original text re-appears in the document.
5. Reject a different row. The doc keeps the original; the `→` line in the sidebar goes greyed + struck-through.
6. Toggle "Edit replacement" on a row, type a custom value, press Enter. The sidebar shows `Replace with: <value>` AND the `→` line under it (sourced from `previews[id]`).
7. Open a doc with ≥10 detections per paragraph. Accept a few in sequence. Confirm reflow doesn't visibly stutter.

- [ ] **Step 3: Commit and push**

```bash
git add README.md
git commit -m "Tick inline-substitution roadmap (issue #27)"
git push
```

The draft PR (#28) will pick up all six commits since it's already linked to this branch.

- [ ] **Step 4: Mark the PR ready for review**

```bash
gh pr ready 28
```

(Skip this step if the user wants to keep the PR in draft pending their own manual review.)

---

## Self-Review Checklist (filled in after writing the plan)

**Spec coverage** — every section of the design spec maps to a Task:

| Spec section                                      | Task             |
| ------------------------------------------------- | ---------------- |
| Drop `InlinePreview.tsx`                          | Task 5           |
| Drop `.inline-preview*` CSS                       | Task 5           |
| Drop `sanctum-previewing` registry                | Task 1           |
| Drop `::highlight(sanctum-previewing)` rule       | Task 1           |
| Drop `inline-preview.test.ts`                     | Task 5           |
| Drop `previewing` membership assertions           | Task 1           |
| New `edit-wrap.ts`                                | Task 2           |
| New `EditReplacement.tsx`                         | Task 4           |
| Changed `DocxView.tsx` (resolve effect order)     | Task 5           |
| Changed `highlights.ts` (drop registry)           | Task 1           |
| Changed `segments.ts` (TreeWalker filter)         | Task 3           |
| Changed `DetectionSidebar.tsx` (replacement line) | Task 6           |
| Changed `App.tsx` (mount swap)                    | Task 5           |
| Changed `index.css` (new + removed blocks)        | Tasks 1, 2, 5, 6 |
| `edit-wrap.test.ts`                               | Task 2           |
| `segments.test.ts` (filter test)                  | Task 3           |
| `EditReplacement.test.tsx` (or `.test.ts`)        | Task 4           |
| `DetectionSidebar.test.tsx` (or `.test.ts`)       | Task 6           |
| Manual smoke test list                            | Task 7           |

No spec gaps.

**Type consistency** — symbols promised in earlier tasks and consumed later:

- `wrapDetections(root, resolved)` (Task 2) → consumed in Task 5 (DocxView).
- `unwrapAll(root)` (Task 2) → not consumed by any other task; keeps the API symmetric for future teardown paths. Acceptable per the spec (`Removed` section explicitly lists it as part of the new module API).
- `applyEditDecorations(root, detections, previews)` (Task 4) → consumed by `EditReplacement` in the same file.
- `pickReplacementVariant(detection, preview)` (Task 6) → consumed by the JSX in the same file.
- `ResolvedDetection` interface (Task 1, kept) → consumed by Task 2.
- `Detection` type (existing) → consumed by Tasks 2, 4, 6.

All call sites match their declarations.

**Placeholder scan** — no "TBD", no "TODO", no "Add appropriate error handling", no "similar to Task N", no "implement later". Each step contains the exact code/command an engineer needs.

Plan is self-contained.
