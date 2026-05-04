// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { unwrapAll, wrapDetections } from '../../../src/renderer/src/review/edit-wrap'
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
    wrapDetections(root, dets)

    const wraps = root.querySelectorAll('.sanctum-edit')
    expect(wraps).toHaveLength(2)
    const a = root.querySelector<HTMLElement>('.sanctum-edit[data-detection-id="a"]')
    const b = root.querySelector<HTMLElement>('.sanctum-edit[data-detection-id="b"]')
    expect(a?.querySelector('.sanctum-edit-original')?.textContent).toBe('Alice')
    expect(b?.querySelector('.sanctum-edit-original')?.textContent).toBe('Bob')
  })

  it('is idempotent — a second call with the same set leaves wraps in place', () => {
    const root = setBody('<p><span data-segment-id="body/p0/r0">Alice met Bob.</span></p>')
    const dets: Detection[] = [
      detection({ id: 'a', start: 0, end: 5 }),
      detection({ id: 'b', start: 10, end: 13 }),
    ]
    wrapDetections(root, dets)
    const firstA = root.querySelector('.sanctum-edit[data-detection-id="a"]')
    wrapDetections(root, dets)
    const secondA = root.querySelector('.sanctum-edit[data-detection-id="a"]')
    // Same node identity proves we didn't re-wrap.
    expect(secondA).toBe(firstA)
    expect(root.querySelectorAll('.sanctum-edit')).toHaveLength(2)
  })

  it('unwraps detections that disappear from the set', () => {
    const root = setBody('<p><span data-segment-id="body/p0/r0">Alice met Bob.</span></p>')
    const both: Detection[] = [
      detection({ id: 'a', start: 0, end: 5 }),
      detection({ id: 'b', start: 10, end: 13 }),
    ]
    wrapDetections(root, both)
    expect(root.querySelectorAll('.sanctum-edit')).toHaveLength(2)

    const onlyA: Detection[] = [detection({ id: 'a', start: 0, end: 5 })]
    wrapDetections(root, onlyA)
    expect(root.querySelectorAll('.sanctum-edit')).toHaveLength(1)
    expect(root.querySelector('.sanctum-edit[data-detection-id="a"]')).not.toBeNull()
    expect(root.querySelector('.sanctum-edit[data-detection-id="b"]')).toBeNull()
    // Bob's text survived in the document.
    expect(root.textContent).toContain('Bob')
  })

  it('skips detections whose range straddles element boundaries without throwing', () => {
    const root = setBody('<p><span data-segment-id="body/p0/r0">Alice <b>and</b> Bob.</span></p>')
    // Span "Alice and" — crosses the <b> boundary.
    const dets: Detection[] = [detection({ id: 'crossing', start: 0, end: 9, text: 'Alice and' })]
    expect(() => {
      wrapDetections(root, dets)
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
    wrapDetections(root, dets)
    expect(root.querySelectorAll('.sanctum-edit')).toHaveLength(2)

    unwrapAll(root)
    expect(root.querySelectorAll('.sanctum-edit')).toHaveLength(0)
    expect(root.textContent).toContain('Alice and Bob.')
  })
})
