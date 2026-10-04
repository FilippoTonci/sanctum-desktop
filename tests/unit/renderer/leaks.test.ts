import { describe, expect, it } from 'vitest'
import { ApiError } from '../../../src/renderer/src/api/types'
import {
  findOccurrences,
  parseLeakError,
  planLeakFixes,
  type SearchSegment,
} from '../../../src/renderer/src/review/leaks'
import type { Detection } from '../../../src/renderer/src/review/types'

function seg(
  id: string,
  text: string,
  block: string | null = null,
  joinBefore = '',
): SearchSegment {
  return { id, text, block, join_before: joinBefore }
}

function detection(overrides: Partial<Detection>): Detection {
  return {
    id: 'd0',
    segmentId: 's0',
    start: 0,
    end: 5,
    text: 'Priya',
    entityType: 'PERSON',
    status: 'accepted',
    ...overrides,
  }
}

describe('parseLeakError', () => {
  it('reads the 422 leak details', () => {
    const err = new ApiError(
      422,
      { error: 'x', details: [{ leak: 'Priya', occurrences: 2 }] },
      'HTTP 422',
    )
    expect(parseLeakError(err)).toEqual({ leaks: [{ value: 'Priya', occurrences: 2 }] })
  })

  it('ignores other errors', () => {
    expect(parseLeakError(new ApiError(500, null, 'boom'))).toBeNull()
    expect(parseLeakError(new Error('x'))).toBeNull()
    expect(parseLeakError('x')).toBeNull()
  })

  it('ignores a 422 without well-formed leak details', () => {
    expect(parseLeakError(new ApiError(422, { error: 'x' }, 'HTTP 422'))).toBeNull()
    expect(parseLeakError(new ApiError(422, { error: 'x', details: [] }, 'HTTP 422'))).toBeNull()
    expect(
      parseLeakError(new ApiError(422, { error: 'x', details: [{ loc: ['body'] }] }, 'HTTP 422')),
    ).toBeNull()
  })
})

describe('findOccurrences', () => {
  it('finds whole-word occurrences across segments', () => {
    const segs = [
      seg('page2/line4', 'Priya Raghunathan, Director'),
      seg('page2/line5', 'Priyanka attended'),
    ]
    expect(findOccurrences(segs, 'Priya')).toEqual([
      { segmentId: 'page2/line4', start: 0, end: 5, text: 'Priya' },
    ])
  })

  it('is case-sensitive like the engine leak check', () => {
    expect(findOccurrences([seg('s0', 'priya and Priya')], 'Priya')).toEqual([
      { segmentId: 's0', start: 10, end: 15, text: 'Priya' },
    ])
  })

  it('finds a value split across runs of one paragraph, one span per run', () => {
    const segs = [
      seg('p0/r0', 'Dear Pri', 'p0'),
      seg('p0/r1', 'ya,', 'p0'),
      seg('p1/r0', 'ya', 'p1'),
    ]
    expect(findOccurrences(segs, 'Priya')).toEqual([
      { segmentId: 'p0/r0', start: 5, end: 8, text: 'Pri' },
      { segmentId: 'p0/r1', start: 0, end: 2, text: 'ya' },
    ])
  })

  it('finds a value broken across PDF lines joined by a space', () => {
    const segs = [
      seg('page1/line3', 'signed by Priya', 'page1/b2'),
      seg('page1/line4', 'Raghunathan today', 'page1/b2', ' '),
    ]
    expect(findOccurrences(segs, 'Priya Raghunathan')).toEqual([
      { segmentId: 'page1/line3', start: 10, end: 15, text: 'Priya' },
      { segmentId: 'page1/line4', start: 0, end: 11, text: 'Raghunathan' },
    ])
  })

  it('does not join segments that have no block', () => {
    const segs = [seg('a', 'Priya'), seg('b', 'Raghunathan', null, ' ')]
    expect(findOccurrences(segs, 'Priya Raghunathan')).toEqual([])
  })

  it('trims whitespace off the pieces and drops whitespace-only ones', () => {
    const segs = [seg('r0', 'Priya', 'p'), seg('r1', ' ', 'p'), seg('r2', 'Raghunathan', 'p')]
    expect(findOccurrences(segs, 'Priya Raghunathan')).toEqual([
      { segmentId: 'r0', start: 0, end: 5, text: 'Priya' },
      { segmentId: 'r2', start: 0, end: 11, text: 'Raghunathan' },
    ])
  })

  it('matches any whitespace run inside the value', () => {
    expect(findOccurrences([seg('s0', 'Priya  Raghunathan')], 'Priya Raghunathan')).toEqual([
      { segmentId: 's0', start: 0, end: 18, text: 'Priya  Raghunathan' },
    ])
  })

  it('escapes regex characters in the value', () => {
    expect(findOccurrences([seg('s0', 'call (555) 010-2000 now')], '(555) 010-2000')).toEqual([
      { segmentId: 's0', start: 5, end: 19, text: '(555) 010-2000' },
    ])
  })

  it('skips spans an accepted detection already covers', () => {
    const segs = [seg('s0', 'Priya met Priya')]
    const existing = [detection({ segmentId: 's0', start: 0, end: 5, status: 'accepted' })]
    expect(findOccurrences(segs, 'Priya', existing)).toEqual([
      { segmentId: 's0', start: 10, end: 15, text: 'Priya' },
    ])
  })

  it('still offers spans the reviewer rejected', () => {
    const segs = [seg('s0', 'Priya met Priya')]
    const existing = [detection({ segmentId: 's0', start: 0, end: 5, status: 'rejected' })]
    expect(findOccurrences(segs, 'Priya', existing)).toHaveLength(2)
  })
})

describe('planLeakFixes', () => {
  it('marks a value with no reachable occurrence as unreachable', () => {
    const segs = [seg('s0', 'Priya is in the body')]
    const report = {
      leaks: [
        { value: 'Priya', occurrences: 1 },
        { value: 'Footnote Name', occurrences: 1 },
      ],
    }
    expect(planLeakFixes(report, segs, [])).toEqual([
      {
        value: 'Priya',
        occurrences: 1,
        reachable: true,
        spans: [{ segmentId: 's0', start: 0, end: 5, text: 'Priya' }],
        keptPlaces: 0,
      },
      { value: 'Footnote Name', occurrences: 1, reachable: false, spans: [], keptPlaces: 0 },
    ])
  })

  it('treats a value whose only visible copies are already redacted as unreachable', () => {
    const segs = [seg('s0', 'Priya')]
    const existing = [detection({ segmentId: 's0', start: 0, end: 5, status: 'accepted' })]
    const plan = planLeakFixes({ leaks: [{ value: 'Priya', occurrences: 1 }] }, segs, existing)
    expect(plan[0]?.reachable).toBe(false)
  })

  it('does not plan overlapping spans when one value contains another', () => {
    const segs = [seg('s0', 'Priya Raghunathan')]
    const report = {
      leaks: [
        { value: 'Priya', occurrences: 1 },
        { value: 'Priya Raghunathan', occurrences: 1 },
      ],
    }
    const plan = planLeakFixes(report, segs, [])
    expect(plan.map((p) => p.value)).toEqual(['Priya', 'Priya Raghunathan'])
    expect(plan[0]).toMatchObject({ reachable: true, spans: [] })
    expect(plan[1]?.spans).toEqual([
      { segmentId: 's0', start: 0, end: 17, text: 'Priya Raghunathan' },
    ])
  })

  it('counts the planned spans that override a place the reviewer kept', () => {
    const segs = [seg('s0', 'Priya met Priya and Priya')]
    const existing = [
      detection({ id: 'kept', segmentId: 's0', start: 10, end: 15, status: 'rejected' }),
      detection({ id: 'done', segmentId: 's0', start: 0, end: 5, status: 'accepted' }),
    ]
    const plan = planLeakFixes({ leaks: [{ value: 'Priya', occurrences: 2 }] }, segs, existing)
    expect(plan[0]?.spans.map((s) => s.start)).toEqual([10, 20])
    expect(plan[0]?.keptPlaces).toBe(1)
  })

  it('counts a kept detection that only partly overlaps the span', () => {
    const segs = [seg('s0', 'Priya Raghunathan')]
    const existing = [detection({ segmentId: 's0', start: 6, end: 17, status: 'rejected' })]
    const plan = planLeakFixes(
      { leaks: [{ value: 'Priya Raghunathan', occurrences: 1 }] },
      segs,
      existing,
    )
    expect(plan[0]?.keptPlaces).toBe(1)
  })
})
