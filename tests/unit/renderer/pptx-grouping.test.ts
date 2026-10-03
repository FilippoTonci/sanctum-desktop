import { describe, expect, it } from 'vitest'
import { groupDetectionsBySlide } from '../../../src/renderer/src/review/pptx-render'

const d = (id: string, segmentId: string) =>
  ({ id, segmentId, start: 0, end: 1, text: 'x', entityType: 'PERSON', status: 'pending' }) as const

describe('groupDetectionsBySlide', () => {
  it('groups by the slide index in the segment id, in slide order', () => {
    const groups = groupDetectionsBySlide([
      d('a', 'slide2/shape0/p0/r0'),
      d('b', 'slide0/notes/p0/r0'),
      d('c', 'slide2/shape1/alt'),
    ])
    expect(groups.map((g) => [g.slide, g.detections.map((x) => x.id)])).toEqual([
      [0, ['b']],
      [2, ['a', 'c']],
    ])
  })

  it('puts ids without a slide prefix in a trailing slide -1 group', () => {
    const groups = groupDetectionsBySlide([
      d('x', 'body/p0/r0'),
      d('a', 'slide1/shape0/p0/r0'),
      d('y', 'user/1'),
    ])
    expect(groups.map((g) => [g.slide, g.detections.map((x) => x.id)])).toEqual([
      [1, ['a']],
      [-1, ['x', 'y']],
    ])
  })

  it('returns no groups for no detections', () => {
    expect(groupDetectionsBySlide([])).toEqual([])
  })
})
