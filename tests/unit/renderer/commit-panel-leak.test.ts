// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import type { SessionsClient } from '../../../src/renderer/src/api/sessions'
import { ApiError, type ReviewSessionResponse } from '../../../src/renderer/src/api/types'
import { CommitPanel } from '../../../src/renderer/src/components/CommitPanel'
import { UNREACHABLE_TEXT } from '../../../src/renderer/src/components/LeakSheet'
import { useReviewStore } from '../../../src/renderer/src/review/store'
import { ReviewActionsProvider } from '../../../src/renderer/src/review/use-actions'

const SEGMENTS = [
  { id: 'p0/r0', text: 'Dear Pri', block: 'p0', join_before: '' },
  { id: 'p0/r1', text: 'ya,', block: 'p0', join_before: '' },
  { id: 'p1/r0', text: 'Priya Raghunathan signed.', block: 'p1', join_before: '' },
]

function session(): ReviewSessionResponse {
  return {
    id: 'sess-1',
    source_path: '/docs/letter.docx',
    format: 'docx',
    default_operator: 'replace',
    default_operator_params: {},
    segments: SEGMENTS,
    proposals: [],
    decisions: [],
    status: 'open',
    created_at: '2026-10-03T00:00:00Z',
    committed_at: null,
    previews: {},
  }
}

const leak422 = (details: { leak: string; occurrences: number }[]): ApiError =>
  new ApiError(422, { error: 'Leak check failed', details }, 'Leak check failed')

function fakeClient(overrides: Partial<SessionsClient>): SessionsClient {
  const noop = (): Promise<never> => Promise.reject(new Error('not implemented in this test'))
  return {
    listSessions: noop,
    createSession: noop,
    getSession: () => Promise.resolve(session()),
    getSessionInput: noop,
    getLayout: noop,
    patchDecision: noop,
    addUserAdded: noop,
    deleteUserAdded: noop,
    commitSession: noop,
    abandonSession: noop,
    ...overrides,
  }
}

let uaCounter = 0
const addUserAdded = vi.fn((_sid: string, body: Parameters<SessionsClient['addUserAdded']>[1]) => {
  uaCounter += 1
  return Promise.resolve({
    decision: {
      kind: 'user_added' as const,
      id: `ua-${String(uaCounter)}`,
      segment_anchor: body.segment_anchor,
      entity_type: 'USER_ADDED',
      original: body.original,
      start: body.start,
      end: body.end,
    },
    preview: '<PERSON>',
  })
})

function renderPanel(client: SessionsClient): void {
  const panel = React.createElement(CommitPanel, {
    client,
    sourceFileName: 'letter.docx',
    sourcePath: '/docs/letter.docx',
    outputSuffix: '_anonymized',
    saveNextToOriginal: true,
    onDone: vi.fn(),
    onOpenAnother: vi.fn(),
  })
  render(
    React.createElement(ReviewActionsProvider, { client, sessionId: 'sess-1', children: panel }),
  )
}

async function attestAndSave(): Promise<void> {
  const user = userEvent.setup()
  await user.click(screen.getByRole('checkbox'))
  await user.click(screen.getByRole('button', { name: 'Save redacted copy…' }))
}

beforeEach(() => {
  uaCounter = 0
  addUserAdded.mockClear()
  const store = useReviewStore.getState()
  store.clear()
  store.setSessionId('sess-1')
  store.setDetections([
    {
      id: 'p1',
      segmentId: 'p1/r0',
      start: 0,
      end: 17,
      text: 'Priya Raghunathan',
      entityType: 'PERSON',
      status: 'accepted',
    },
  ])
  store.openCommitPanel()
  ;(window as unknown as { sanctum: unknown }).sanctum = {
    showSaveDialog: () =>
      Promise.resolve({ canceled: false, filePath: '/out/letter_anonymized.docx' }),
  }
})

afterEach(() => {
  cleanup()
})

describe('CommitPanel leak sheet', () => {
  it('explains the refusal, redacts the remaining copies and saves', async () => {
    const commitSession = vi
      .fn()
      .mockRejectedValueOnce(leak422([{ leak: 'Priya', occurrences: 1 }]))
      .mockResolvedValueOnce({
        session_id: 'sess-1',
        output_path: '/out/letter_anonymized.docx',
        committed_at: '2026-10-03T00:00:00Z',
      })
    renderPanel(fakeClient({ commitSession, addUserAdded }))

    await attestAndSave()
    await screen.findByText('Some redacted text is still in the document')
    expect(screen.getByTestId('leak-sheet').textContent).toContain('Priya — 1 more place')

    await userEvent.setup().click(screen.getByRole('button', { name: 'Redact these too' }))
    await screen.findByText('Redacted copy saved')

    // The run-split "Pri" + "ya" got one finding per run, added one at a time.
    expect(addUserAdded.mock.calls.map((c) => c[1])).toEqual([
      { segment_anchor: 'p0/r0', entity_type: 'USER_ADDED', original: 'Pri', start: 5, end: 8 },
      { segment_anchor: 'p0/r1', entity_type: 'USER_ADDED', original: 'ya', start: 0, end: 2 },
    ])
    expect(commitSession).toHaveBeenCalledTimes(2)
    expect(commitSession.mock.calls[1]?.[1]).toEqual({
      output_path: '/out/letter_anonymized.docx',
      attested: true,
    })
    const ids = useReviewStore.getState().detections.map((d) => d.id)
    expect(ids).toEqual(expect.arrayContaining(['user:ua-1', 'user:ua-2']))
    expect(useReviewStore.getState().undoStack).toHaveLength(2)
  })

  it('shows the sheet again with the new details when the retry is refused', async () => {
    const commitSession = vi
      .fn()
      .mockRejectedValueOnce(leak422([{ leak: 'Priya', occurrences: 1 }]))
      .mockRejectedValueOnce(leak422([{ leak: 'Hidden Name', occurrences: 2 }]))
    renderPanel(fakeClient({ commitSession, addUserAdded }))

    await attestAndSave()
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Redact these too' }))

    await waitFor(() => {
      expect(screen.getByTestId('leak-sheet').textContent).toContain('Hidden Name — 2 more places')
    })
    expect(screen.getByText(UNREACHABLE_TEXT)).toBeTruthy()
    // Every value is unreachable: nothing left to redact from here.
    expect(screen.queryByRole('button', { name: 'Redact these too' })).toBeNull()
    expect(commitSession).toHaveBeenCalledTimes(2)
  })

  it('marks only the unreachable value and still offers to redact the rest', async () => {
    const commitSession = vi.fn().mockRejectedValueOnce(
      leak422([
        { leak: 'Priya', occurrences: 1 },
        { leak: 'Footnote Person', occurrences: 1 },
      ]),
    )
    renderPanel(fakeClient({ commitSession, addUserAdded }))

    await attestAndSave()
    await screen.findByRole('button', { name: 'Redact these too' })
    expect(screen.getAllByText(UNREACHABLE_TEXT)).toHaveLength(1)
  })

  it('Back to review closes the sheet and reopening shows a clean form', async () => {
    const commitSession = vi
      .fn()
      .mockRejectedValueOnce(leak422([{ leak: 'Priya', occurrences: 1 }]))
    renderPanel(fakeClient({ commitSession, addUserAdded }))

    await attestAndSave()
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Back to review' }))
    expect(useReviewStore.getState().commitPanelOpen).toBe(false)

    useReviewStore.getState().openCommitPanel()
    await screen.findByText('Save redacted copy')
    expect(screen.queryByTestId('leak-sheet')).toBeNull()
    expect(addUserAdded).not.toHaveBeenCalled()
  })

  it('does not show a previous error after Cancel and reopen', async () => {
    const commitSession = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(500, { error: 'boom' }, 'boom'))
    renderPanel(fakeClient({ commitSession }))

    await attestAndSave()
    await waitFor(() => {
      expect(screen.getByTestId('commit-panel').textContent).toContain('boom')
    })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Cancel' }))
    useReviewStore.getState().openCommitPanel()

    await screen.findByText('Save redacted copy')
    expect(screen.getByTestId('commit-panel').textContent).not.toContain('boom')
  })
})
