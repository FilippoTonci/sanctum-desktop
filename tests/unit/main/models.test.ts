import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadModel } from '../../../src/main/models'

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

function fakeBody(bytes: Buffer): Response {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: { 'content-length': bytes.length.toString() },
  })
}

describe('downloadModel', () => {
  let destination: string

  beforeEach(async () => {
    destination = await mkdtemp(join(tmpdir(), 'sanctum-models-'))
  })

  afterEach(async () => {
    await rm(destination, { recursive: true, force: true })
  })

  it('streams the archive to disk and verifies the sha256', async () => {
    const bytes = Buffer.from('0'.repeat(128), 'utf8')
    const digest = sha256(bytes)
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(fakeBody(bytes))

    const result = await downloadModel({
      descriptor: {
        id: 'en_core_web_lg',
        version: '3.7.1',
        sha256: digest,
        sizeBytes: bytes.length,
      },
      destination,
      fetchFn,
    })

    expect(result.sha256).toBe(digest)
    expect(result.bytes).toBe(bytes.length)
    const written = await readFile(result.archivePath)
    expect(written.toString('utf8')).toBe(bytes.toString('utf8'))
  })

  it('rejects when the sha256 does not match the descriptor', async () => {
    const bytes = Buffer.from('hello')
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(fakeBody(bytes))

    await expect(
      downloadModel({
        descriptor: {
          id: 'tampered',
          version: 'v1',
          sha256: '00'.repeat(32),
          sizeBytes: bytes.length,
        },
        destination,
        fetchFn,
      }),
    ).rejects.toThrow(/sha256 mismatch/)
  })

  it('raises an error when the CDN returns a non-2xx status', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('not found', { status: 404 }))

    await expect(
      downloadModel({
        descriptor: { id: 'missing', version: 'v1', sha256: '0'.repeat(64), sizeBytes: 0 },
        destination,
        fetchFn,
      }),
    ).rejects.toThrow(/download failed \(404\)/)
  })
})
