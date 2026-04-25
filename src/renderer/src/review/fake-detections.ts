/**
 * Synthesise plausible-looking detections by scanning the rendered DOM
 * for well-known PII patterns (emails, US-style phone numbers, dates).
 *
 * This is the slice-4 / slice-5 stand-in for the real review session
 * the backend will provide once the review-session contract lands. The
 * goal is *not* accurate detection — it's exercising the overlay,
 * sidebar, and keyboard map against credible-looking data so the WS5
 * wire-up is a one-line swap (`fakeDetections` → `sessionDetections`).
 *
 * Patterns are deliberately conservative so they fire reliably on the
 * `nda_contract.docx` fixture without producing weird matches on
 * boilerplate ("This Agreement", "WHEREAS").
 */

import type { Detection } from './types'

interface PatternSpec {
  readonly entityType: string
  readonly regex: RegExp
}

const PATTERNS: readonly PatternSpec[] = [
  { entityType: 'EMAIL_ADDRESS', regex: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  {
    entityType: 'DATE_TIME',
    regex:
      /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/g,
  },
  { entityType: 'US_ZIP', regex: /\b\d{5}(?:-\d{4})?\b/g },
]

export function seedFakeDetections(root: ParentNode): Detection[] {
  const out: Detection[] = []
  const segments = root.querySelectorAll<HTMLElement>('[data-segment-id]')

  for (const segEl of segments) {
    const segmentId = segEl.getAttribute('data-segment-id')
    if (segmentId === null) continue
    const text = segEl.textContent
    if (text.length === 0) continue

    for (const { entityType, regex } of PATTERNS) {
      regex.lastIndex = 0
      let match: RegExpExecArray | null = regex.exec(text)
      while (match !== null) {
        out.push({
          id: `fake:${entityType}:${segmentId}:${String(match.index)}`,
          segmentId,
          start: match.index,
          end: match.index + match[0].length,
          text: match[0],
          entityType,
          status: 'pending',
        })
        match = regex.exec(text)
      }
    }
  }
  return out
}
