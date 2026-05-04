// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  resolveDetections,
  applyHighlightRegistries,
} from '../../../src/renderer/src/review/highlights'
import { seedFakeDetections } from '../../../src/renderer/src/review/fake-detections'
import type { Detection } from '../../../src/renderer/src/review/types'

function setBody(html: string): HTMLElement {
  document.body.innerHTML = html
  return document.body
}

describe('resolveDetections', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('drops detections whose run is not currently rendered', () => {
    const root = setBody('<p><span data-segment-id="body/p0/r0">Hi Alice.</span></p>')
    const detections: Detection[] = [
      {
        id: 'a',
        segmentId: 'body/p0/r0',
        start: 3,
        end: 8,
        text: 'Alice',
        entityType: 'PERSON',
        status: 'pending',
      },
      {
        id: 'b',
        segmentId: 'body/p99/r0',
        start: 0,
        end: 1,
        text: 'X',
        entityType: 'PERSON',
        status: 'pending',
      },
    ]
    const resolved = resolveDetections(root, detections)
    expect(resolved).toHaveLength(1)
    expect(resolved[0]?.detection.id).toBe('a')
    expect(resolved[0]?.range.toString()).toBe('Alice')
  })

  it('returns an empty list for an empty detection set', () => {
    const root = setBody('<p><span data-segment-id="body/p0/r0">Hi.</span></p>')
    expect(resolveDetections(root, [])).toEqual([])
  })
})

describe('seedFakeDetections', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('finds emails, dates, and zip codes inside segment runs', () => {
    const root = setBody(`
      <p><span data-segment-id="body/p0/r0">Reach me at alice@example.com on December 22, 2025.</span></p>
      <p><span data-segment-id="body/p2/r0">Office at zip 36922-1100.</span></p>
    `)
    const seeded = seedFakeDetections(root)
    const byType = new Map<string, Detection[]>()
    for (const d of seeded) {
      const list = byType.get(d.entityType) ?? []
      list.push(d)
      byType.set(d.entityType, list)
    }
    expect(byType.get('EMAIL_ADDRESS')?.[0]?.text).toBe('alice@example.com')
    expect(byType.get('DATE_TIME')?.[0]?.text).toBe('December 22, 2025')
    expect(byType.get('US_ZIP')?.[0]?.text).toBe('36922-1100')
  })

  it('produces stable ids that disambiguate multiple matches in one run', () => {
    const root = setBody('<p><span data-segment-id="body/p0/r0">a@x.com and b@y.com</span></p>')
    const seeded = seedFakeDetections(root)
    expect(seeded).toHaveLength(2)
    expect(seeded[0]!.id).not.toBe(seeded[1]!.id)
  })

  it('emits start/end offsets that point at the matched substring', () => {
    const text = 'Email me at alice@example.com please.'
    const root = setBody(`<p><span data-segment-id="body/p0/r0">${text}</span></p>`)
    const seeded = seedFakeDetections(root)
    const email = seeded.find((d) => d.entityType === 'EMAIL_ADDRESS')!
    expect(text.slice(email.start, email.end)).toBe('alice@example.com')
  })

  it('marks every seeded detection as pending so nothing arrives pre-decided', () => {
    const root = setBody(
      '<p><span data-segment-id="body/p0/r0">a@x.com on January 1, 2024 in 12345.</span></p>',
    )
    const seeded = seedFakeDetections(root)
    expect(seeded).not.toHaveLength(0)
    for (const d of seeded) expect(d.status).toBe('pending')
  })
})

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
  const css = (globalThis as unknown as { CSS: unknown }).CSS ?? {}
  ;(
    css as unknown as {
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
  ;(globalThis as unknown as { CSS: unknown }).CSS = css
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

    expect(registries['sanctum-pending']!.ranges.map((r) => r.toString())).toEqual(
      expect.arrayContaining(['Alice', 'Dan']),
    )
    expect(registries['sanctum-focused']!.ranges.map((r) => r.toString())).toEqual(['Alice'])
  })
})
