import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'

const ROOT = join(__dirname, '..', '..', '..')

describe('docx-preview patch (data-segment-id)', () => {
  it('patches/docx-preview+0.3.7.patch exists and wires segment ids', () => {
    const patch = readFileSync(join(ROOT, 'patches', 'docx-preview+0.3.7.patch'), 'utf8')
    expect(patch).toContain('this.assignSegmentIds(document.children)')
    expect(patch).toContain('result.setAttribute("data-segment-id", elem.dataSegmentId)')
    expect(patch).toContain('body/p${bodyParaIdx}')
    expect(patch).toContain('table/t${tableIdx}')
  })

  it('post-install patch is applied to the installed bundle', () => {
    const bundle = readFileSync(
      join(ROOT, 'node_modules', 'docx-preview', 'dist', 'docx-preview.mjs'),
      'utf8',
    )
    expect(bundle).toContain('assignSegmentIds(bodyChildren)')
    expect(bundle).toContain('data-segment-id')
  })
})
