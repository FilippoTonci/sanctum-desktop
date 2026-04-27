import { describe, expect, it } from 'vitest'
import { describeStatus, errorMessage } from '../../../src/renderer/src/components/TypedError'
import { ApiError } from '../../../src/renderer/src/api/types'

describe('describeStatus', () => {
  it('returns the session-conflict copy for 409', () => {
    expect(describeStatus(409).title).toMatch(/session/i)
  })

  it('returns the file-too-large copy for 413', () => {
    expect(describeStatus(413).title).toMatch(/file too large/i)
  })

  it('returns the unsupported-format copy for 415', () => {
    expect(describeStatus(415).title).toMatch(/unsupported/i)
  })

  it('returns the sidecar-unavailable copy for 503', () => {
    expect(describeStatus(503).title).toMatch(/unavailable/i)
  })

  it('returns generic copy for null (non-HTTP errors)', () => {
    expect(describeStatus(null).title).toBe('Something went wrong')
  })

  it('falls through with a status code for unmapped HTTP errors', () => {
    expect(describeStatus(418).title).toBe('Backend returned HTTP 418')
  })
})

describe('errorMessage', () => {
  it('extracts message from ApiError', () => {
    expect(errorMessage(new ApiError(503, null, 'sidecar gone'))).toBe('sidecar gone')
  })

  it('extracts message from a plain Error', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom')
  })

  it('returns string values verbatim', () => {
    expect(errorMessage('something nondescript')).toBe('something nondescript')
  })

  it('falls back to a sentinel for unknown shapes', () => {
    expect(errorMessage(undefined)).toBe('Unknown error.')
    expect(errorMessage({ weird: 'object' })).toBe('Unknown error.')
  })
})
