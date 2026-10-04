/**
 * Leak-check refusals: read the engine's 422 and find where each leaked
 * value still sits in the reviewable text.
 *
 * After writing the redacted copy the engine re-reads it; when a value it
 * redacted somewhere still appears elsewhere it deletes the output and
 * answers 422 with `{ error, details: [{ leak, occurrences }] }`. The
 * values are all the engine sends back, so the desktop locates them itself
 * the way the engine's own detection and leak check read the document
 * (engine Ruling 14): segments that share a `block` are one paragraph,
 * joined in order with each segment's `join_before` between them. A name
 * Word split across runs ("Pri" + "ya") or a PDF broke across lines reads
 * back whole, and each hit is projected back onto the segments it covers,
 * one span per segment.
 *
 * A value with no occurrence left in any segment lives somewhere the
 * reviewer cannot reach (a footnote, text box, field code, chart …,
 * engine Ruling 17): the sheet says so and the save stays blocked.
 */

import { ApiError } from '../api/types'
import type { Detection } from './types'

export interface LeakReport {
  readonly leaks: readonly { readonly value: string; readonly occurrences: number }[]
}

/** The part of a session `TextSegment` the search needs. */
export interface SearchSegment {
  readonly id: string
  readonly text: string
  readonly block?: string | null
  readonly join_before?: string
}

/** One piece of a hit, in the coordinates of a single segment. */
export interface Occurrence {
  readonly segmentId: string
  readonly start: number
  readonly end: number
  readonly text: string
}

export interface LeakFix {
  readonly value: string
  readonly occurrences: number
  /** False when no occurrence is left in any reviewable segment. */
  readonly reachable: boolean
  /** Spans to add as user findings (may be empty for a reachable value
   *  whose copies are covered by another value's spans). */
  readonly spans: readonly Occurrence[]
  /**
   * How many of `spans` overlap a detection the reviewer chose to keep
   * (rejected). Adding a finding there makes the engine drop that
   * proposal, so the keep is lost and undo does not bring it back: the
   * sheet says so and asks for explicit confirmation.
   */
  readonly keptPlaces: number
}

/** The leak details of a commit refusal, or null for any other error. */
export function parseLeakError(err: unknown): LeakReport | null {
  if (!(err instanceof ApiError) || err.status !== 422) return null
  const details = err.body?.details
  if (!Array.isArray(details) || details.length === 0) return null
  const leaks: { value: string; occurrences: number }[] = []
  for (const d of details as readonly Record<string, unknown>[]) {
    const leak = d.leak
    const occurrences = d.occurrences
    if (typeof leak !== 'string' || typeof occurrences !== 'number') return null
    leaks.push({ value: leak, occurrences })
  }
  return { leaks }
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const ALNUM = /[\p{L}\p{N}]/u

/**
 * The engine's matcher (`sanctum/core/leak_check.py`): case-sensitive,
 * any whitespace run in the value matches any whitespace run in the text,
 * and an end that is a letter or digit must not be glued to another one.
 */
function matcherFor(value: string): RegExp | null {
  const words = value
    .trim()
    .split(/\s+/u)
    .filter((w) => w !== '')
  if (words.length === 0) return null
  let pattern = words.map(escapeRegExp).join('\\s+')
  const first = words[0] ?? ''
  const last = words[words.length - 1] ?? ''
  if (ALNUM.test(first.charAt(0))) pattern = `(?<![\\p{L}\\p{N}])${pattern}`
  if (ALNUM.test(last.charAt(last.length - 1))) pattern = `${pattern}(?![\\p{L}\\p{N}])`
  return new RegExp(pattern, 'gu')
}

interface JoinedBlock {
  readonly segments: readonly SearchSegment[]
  readonly offsets: readonly number[]
  readonly text: string
}

/**
 * Group by `block` in document order; segments without one stand alone.
 *
 * The search never crosses a block boundary, matching how detection reads
 * the document. The engine's leak check, though, reads the whole output as
 * one whitespace-normalized text, so it can report a value that straddles
 * two blocks (the end of one paragraph and the start of the next). Such a
 * value has no hit here, is labelled unreachable, and the save stays
 * blocked until the reviewer edits the original.
 */
function joinBlocks(segments: readonly SearchSegment[]): JoinedBlock[] {
  const groups = new Map<string, SearchSegment[]>()
  const order: SearchSegment[][] = []
  for (const seg of segments) {
    const block = seg.block ?? null
    if (block === null) {
      order.push([seg])
      continue
    }
    let group = groups.get(block)
    if (group === undefined) {
      group = []
      groups.set(block, group)
      order.push(group)
    }
    group.push(seg)
  }
  return order.map((group) => {
    let text = ''
    const offsets: number[] = []
    group.forEach((seg, i) => {
      if (i > 0 && seg.join_before !== undefined) text += seg.join_before
      offsets.push(text.length)
      text += seg.text
    })
    return { segments: group, offsets, text }
  })
}

const isCovered = (span: Occurrence, existing: readonly Detection[]): boolean =>
  existing.some(
    (d) =>
      d.status === 'accepted' &&
      d.segmentId === span.segmentId &&
      d.start <= span.start &&
      span.end <= d.end,
  )

/**
 * Every place `value` still appears, one span per segment a hit covers.
 * Pieces are trimmed of edge whitespace (a run holding only the space
 * between two names is left alone), and pieces an accepted detection in
 * `existing` already covers are skipped. A rejected detection does not
 * count: the reviewer kept that copy, which is why it leaked.
 */
export function findOccurrences(
  segments: readonly SearchSegment[],
  value: string,
  existing: readonly Detection[] = [],
): Occurrence[] {
  const matcher = matcherFor(value)
  if (matcher === null) return []
  const out: Occurrence[] = []
  for (const block of joinBlocks(segments)) {
    for (const match of block.text.matchAll(matcher)) {
      const hitStart = match.index
      const hitEnd = hitStart + match[0].length
      block.segments.forEach((seg, i) => {
        const off = block.offsets[i] ?? 0
        let s = Math.max(hitStart, off) - off
        let e = Math.min(hitEnd, off + seg.text.length) - off
        while (s < e && /\s/u.test(seg.text.charAt(s))) s++
        while (e > s && /\s/u.test(seg.text.charAt(e - 1))) e--
        if (s >= e) return // outside this segment, inside join_before, or blank
        const span = { segmentId: seg.id, start: s, end: e, text: seg.text.slice(s, e) }
        if (!isCovered(span, existing)) out.push(span)
      })
    }
  }
  return out
}

const overlaps = (a: Occurrence, b: Occurrence): boolean =>
  a.segmentId === b.segmentId && a.start < b.end && b.start < a.end

const overlapsKept = (span: Occurrence, existing: readonly Detection[]): boolean =>
  existing.some((d) => d.status === 'rejected' && overlaps(span, d))

/**
 * Work out what "Redact these too" adds for each leaked value, in report
 * order. Longer values claim their spans first so "Priya Raghunathan"
 * wins over a nested "Priya": two overlapping user findings would fight
 * over the same characters.
 */
export function planLeakFixes(
  report: LeakReport,
  segments: readonly SearchSegment[],
  existing: readonly Detection[],
): LeakFix[] {
  const found = report.leaks.map((leak) => findOccurrences(segments, leak.value, existing))
  const byLength = report.leaks
    .map((leak, i) => ({ i, length: leak.value.trim().length }))
    .sort((a, b) => b.length - a.length || a.i - b.i)
  const claimed: Occurrence[] = []
  const spans: Occurrence[][] = report.leaks.map(() => [])
  for (const { i } of byLength) {
    for (const span of found[i] ?? []) {
      if (claimed.some((c) => overlaps(c, span))) continue
      claimed.push(span)
      spans[i]?.push(span)
    }
  }
  return report.leaks.map((leak, i) => ({
    value: leak.value,
    occurrences: leak.occurrences,
    reachable: (found[i]?.length ?? 0) > 0,
    spans: spans[i] ?? [],
    keptPlaces: (spans[i] ?? []).filter((span) => overlapsKept(span, existing)).length,
  }))
}
