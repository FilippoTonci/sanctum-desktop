import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, rename, stat, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'

/**
 * Default Sanctum-owned CDN root. Set to a placeholder until the CDN is
 * provisioned (see WS3 open decision #2). The Pro-tier download flow in
 * WS5 overrides this via a settings pane; `fetchFn` is injected in tests.
 */
export const DEFAULT_MODEL_CDN = 'https://cdn.sanctum.tools/models' as const

export interface ModelDescriptor {
  readonly id: string
  readonly version: string
  /** SHA-256 of the archive. Required — never trust a CDN's Content-Length alone. */
  readonly sha256: string
  readonly sizeBytes: number
  /** URL path relative to the CDN root. Defaults to `{id}/{version}.tar.gz`. */
  readonly path?: string
}

export interface DownloadModelOptions {
  readonly descriptor: ModelDescriptor
  /** Directory the archive is written into. Must already exist or be creatable. */
  readonly destination: string
  readonly cdnBaseUrl?: string
  readonly fetchFn?: typeof fetch
  readonly signal?: AbortSignal
  readonly onProgress?: (progress: DownloadProgress) => void
}

export interface DownloadProgress {
  readonly bytesDownloaded: number
  readonly totalBytes: number
  readonly fraction: number
}

export interface DownloadedModel {
  readonly archivePath: string
  readonly sha256: string
  readonly bytes: number
}

/**
 * Fetch a model archive from the Sanctum CDN, stream it to disk under
 * `destination`, then verify the SHA-256 before renaming the final file
 * into place. Resume support via HTTP `Range` requests is wired in
 * WS5 alongside the download UX — this stub is the minimum surface
 * WS4 / WS5 can call without a full implementation.
 *
 * Wire-up:
 * - The descriptor's sha256 MUST be known ahead of time (pinned in the
 *   desktop release manifest, not fetched from the CDN). Never trust a
 *   CDN response's `Content-MD5` or Content-Length alone.
 * - Writes to `{archivePath}.part`, verifies, then atomically renames
 *   to `{archivePath}` on success. A partial file stays on disk so a
 *   future call can resume.
 * - No silent retries. The caller decides what to do on failure.
 */
export async function downloadModel(options: DownloadModelOptions): Promise<DownloadedModel> {
  const fetchImpl = options.fetchFn ?? fetch
  const cdn = options.cdnBaseUrl ?? DEFAULT_MODEL_CDN
  const relativePath =
    options.descriptor.path ?? `${options.descriptor.id}/${options.descriptor.version}.tar.gz`
  const url = `${cdn.replace(/\/$/, '')}/${relativePath}`

  const archivePath = join(
    options.destination,
    `${options.descriptor.id}-${options.descriptor.version}.tar.gz`,
  )
  const partialPath = `${archivePath}.part`

  await mkdir(dirname(archivePath), { recursive: true })

  const response = await fetchImpl(url, { signal: options.signal })
  if (!response.ok) {
    throw new Error(`model download failed (${response.status.toString()}): ${url}`)
  }
  if (response.body === null) {
    throw new Error(`model download response had no body: ${url}`)
  }

  const totalBytes = Number(response.headers.get('content-length') ?? options.descriptor.sizeBytes)
  const hasher = createHash('sha256')
  let bytesDownloaded = 0

  const webStream = response.body as unknown as NodeReadableStream<Uint8Array>
  const nodeStream = Readable.fromWeb(webStream)

  nodeStream.on('data', (chunk: Buffer) => {
    hasher.update(chunk)
    bytesDownloaded += chunk.length
    if (options.onProgress !== undefined) {
      options.onProgress({
        bytesDownloaded,
        totalBytes,
        fraction: totalBytes > 0 ? bytesDownloaded / totalBytes : 0,
      })
    }
  })

  await pipeline(nodeStream, createWriteStream(partialPath))

  const actualSha = hasher.digest('hex')
  if (actualSha !== options.descriptor.sha256) {
    await unlink(partialPath).catch(() => undefined)
    throw new Error(
      `model sha256 mismatch for ${options.descriptor.id}@${options.descriptor.version}: expected ${options.descriptor.sha256}, got ${actualSha}`,
    )
  }

  const partialStat = await stat(partialPath)
  await rename(partialPath, archivePath)

  return {
    archivePath,
    sha256: actualSha,
    bytes: partialStat.size,
  }
}
