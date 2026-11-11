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

describe('PDF tokens fit their box (sanctum#59)', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  const fake = (proto: object, prop: string, value: number): (() => void) => {
    const original = Object.getOwnPropertyDescriptor(proto, prop)
    Object.defineProperty(proto, prop, { configurable: true, get: () => value })
    return () => {
      if (original) Object.defineProperty(proto, prop, original)
    }
  }

  it('shrinks a token wider than the original span instead of cutting it off', () => {
    const root = setBody(`<div class="pdf-text-layer">${wrapped('a', 'LLP')}</div>`)
    const restore = [
      fake(HTMLElement.prototype, 'scrollWidth', 120),
      fake(HTMLElement.prototype, 'clientWidth', 60),
    ]
    try {
      applyEditDecorations(root, [detection({ id: 'a', status: 'accepted' })], {
        a: '<ORGANIZATION>',
      })
    } finally {
      restore.forEach((r) => {
        r()
      })
    }
    const el = root.querySelector<HTMLElement>('.sanctum-edit-replacement')!
    expect(el.style.getPropertyValue('--fit')).toBe('0.5')
  })

  it('never shrinks below the minimum, and leaves fitting tokens and docx alone', () => {
    const root = setBody(
      `<div class="pdf-text-layer">${wrapped('a', 'L')}</div><p>${wrapped('b', 'LLP')}</p>`,
    )
    const restore = [
      fake(HTMLElement.prototype, 'scrollWidth', 400),
      fake(HTMLElement.prototype, 'clientWidth', 40),
    ]
    try {
      applyEditDecorations(
        root,
        [detection({ id: 'a', status: 'accepted' }), detection({ id: 'b', status: 'accepted' })],
        { a: '<ORGANIZATION>', b: '<ORGANIZATION>' },
      )
    } finally {
      restore.forEach((r) => {
        r()
      })
    }
    const [a, b] = root.querySelectorAll<HTMLElement>('.sanctum-edit-replacement')
    expect(a!.style.getPropertyValue('--fit')).toBe('0.45')
    expect(b!.style.getPropertyValue('--fit')).toBe('')
  })
})
