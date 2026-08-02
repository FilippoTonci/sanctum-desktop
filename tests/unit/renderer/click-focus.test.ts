// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { detectionIdFromClick } from '../../../src/renderer/src/review/click-focus'

function setBody(html: string): HTMLElement {
  document.body.innerHTML = html
  return document.body
}

const WRAPPED =
  '<p><span data-segment-id="body/p0/r0">' +
  '<span class="sanctum-edit" data-detection-id="d1">' +
  '<span class="sanctum-edit-original">Alice</span>' +
  '<span class="sanctum-edit-replacement">[PERSON_1]</span>' +
  '</span>' +
  ' met Bob.</span></p>'

describe('detectionIdFromClick', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('returns the detection id for a click on the original text', () => {
    const root = setBody(WRAPPED)
    const original = root.querySelector('.sanctum-edit-original')
    expect(detectionIdFromClick(original, true)).toBe('d1')
  })

  it('returns the detection id for a click on the replacement preview', () => {
    const root = setBody(WRAPPED)
    const replacement = root.querySelector('.sanctum-edit-replacement')
    expect(detectionIdFromClick(replacement, true)).toBe('d1')
  })

  it('returns the detection id for a click on the wrap itself', () => {
    const root = setBody(WRAPPED)
    const wrap = root.querySelector('.sanctum-edit')
    expect(detectionIdFromClick(wrap, true)).toBe('d1')
  })

  it('returns null for a click outside any wrap', () => {
    const root = setBody(WRAPPED)
    const segment = root.querySelector('[data-segment-id]')
    expect(detectionIdFromClick(segment, true)).toBeNull()
  })

  it('returns null while a text selection is active, so drag-select is not hijacked', () => {
    const root = setBody(WRAPPED)
    const original = root.querySelector('.sanctum-edit-original')
    expect(detectionIdFromClick(original, false)).toBeNull()
  })

  it('returns null for a null target', () => {
    expect(detectionIdFromClick(null, true)).toBeNull()
  })

  it('returns null for a non-Element target', () => {
    expect(detectionIdFromClick(document, true)).toBeNull()
  })
})
