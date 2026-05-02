// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { pickRecent, pickStale } from '../../../src/renderer/src/components/RecentSessions'
import type { ReviewSessionIndexEntry } from '../../../src/renderer/src/api/types'

function entry(
  id: string,
  createdAt: string,
  status: ReviewSessionIndexEntry['status'] = 'open',
): ReviewSessionIndexEntry {
  return {
    id,
    source_path: `/tmp/${id}.docx`,
    format: 'docx',
    status,
    created_at: createdAt,
    committed_at: null,
    accepted_count: 0,
    rejected_count: 0,
    pending_count: 0,
  }
}

describe('pickRecent', () => {
  it('returns an empty list when given none', () => {
    expect(pickRecent([])).toEqual([])
  })

  it('returns all rows when at or below the cap', () => {
    const sessions = [
      entry('a', '2026-04-01T10:00:00Z'),
      entry('b', '2026-04-02T10:00:00Z'),
      entry('c', '2026-04-03T10:00:00Z'),
    ]
    const out = pickRecent(sessions)
    expect(out.map((s) => s.id)).toEqual(['c', 'b', 'a'])
  })

  it('caps at 5 newest by created_at', () => {
    const sessions = [
      entry('old-1', '2026-01-01T10:00:00Z'),
      entry('newest', '2026-04-30T10:00:00Z'),
      entry('old-2', '2026-01-02T10:00:00Z'),
      entry('mid-1', '2026-03-01T10:00:00Z'),
      entry('mid-2', '2026-03-02T10:00:00Z'),
      entry('mid-3', '2026-03-03T10:00:00Z'),
      entry('mid-4', '2026-03-04T10:00:00Z'),
    ]
    const out = pickRecent(sessions)
    expect(out).toHaveLength(5)
    expect(out.map((s) => s.id)).toEqual(['newest', 'mid-4', 'mid-3', 'mid-2', 'mid-1'])
  })

  it('respects an explicit limit override', () => {
    const sessions = [
      entry('a', '2026-04-01T10:00:00Z'),
      entry('b', '2026-04-02T10:00:00Z'),
      entry('c', '2026-04-03T10:00:00Z'),
    ]
    expect(pickRecent(sessions, 2).map((s) => s.id)).toEqual(['c', 'b'])
  })

  it('breaks ties on created_at with stable original-order ranking', () => {
    const sessions = [
      entry('first', '2026-04-01T10:00:00Z'),
      entry('second', '2026-04-01T10:00:00Z'),
      entry('third', '2026-04-01T10:00:00Z'),
    ]
    expect(pickRecent(sessions).map((s) => s.id)).toEqual(['first', 'second', 'third'])
  })

  it('sinks unparseable timestamps to the bottom', () => {
    const sessions = [entry('garbage', 'not-a-date'), entry('good', '2026-04-01T10:00:00Z')]
    expect(pickRecent(sessions, 1).map((s) => s.id)).toEqual(['good'])
  })
})

describe('pickStale', () => {
  it('returns nothing when at or below the cap', () => {
    const sessions = [entry('a', '2026-04-01T10:00:00Z'), entry('b', '2026-04-02T10:00:00Z')]
    expect(pickStale(sessions)).toEqual([])
  })

  it('returns rows ranked outside the top N', () => {
    const sessions = [
      entry('drop-1', '2026-01-01T10:00:00Z'),
      entry('drop-2', '2026-01-02T10:00:00Z'),
      entry('keep-1', '2026-04-01T10:00:00Z'),
      entry('keep-2', '2026-04-02T10:00:00Z'),
      entry('keep-3', '2026-04-03T10:00:00Z'),
      entry('keep-4', '2026-04-04T10:00:00Z'),
      entry('keep-5', '2026-04-05T10:00:00Z'),
    ]
    const stale = pickStale(sessions)
    expect(stale.map((s) => s.id).sort()).toEqual(['drop-1', 'drop-2'])
  })

  it('respects an explicit limit override', () => {
    const sessions = [
      entry('a', '2026-04-01T10:00:00Z'),
      entry('b', '2026-04-02T10:00:00Z'),
      entry('c', '2026-04-03T10:00:00Z'),
    ]
    const stale = pickStale(sessions, 1)
    expect(stale.map((s) => s.id).sort()).toEqual(['a', 'b'])
  })
})
