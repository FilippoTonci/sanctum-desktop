import { setTimeout as delay } from 'node:timers/promises'

export interface HealthResponse {
  readonly status: string
  readonly sanctum_commit?: string
  readonly openapi_digest?: string
  readonly mapping_store_unlocked?: boolean
}

export interface PollHealthOptions {
  readonly baseUrl: string
  readonly token: string
  readonly timeoutMs?: number
  readonly intervalMs?: number
  readonly signal?: AbortSignal
  readonly fetchFn?: typeof fetch
}

const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_INTERVAL_MS = 500

/**
 * Poll `GET /health` with the bearer token until it returns 200 OK and
 * a decodable JSON body, or the timeout elapses. The sidecar's
 * `SANCTUM_READY` stdout line signals "HTTP listener bound", but the
 * NLP models (especially GLiNER on the Professional tier) can still
 * be loading for tens of seconds afterwards. `/health` is authoritative
 * for engine-ready.
 */
export async function pollHealth(options: PollHealthOptions): Promise<HealthResponse> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS
  const fetchImpl = options.fetchFn ?? fetch
  const deadline = Date.now() + timeoutMs

  let lastError: unknown = null

  while (Date.now() < deadline) {
    if (options.signal?.aborted === true) {
      throw new Error('health poll aborted')
    }

    try {
      const response = await fetchImpl(`${options.baseUrl}/health`, {
        headers: { Authorization: `Bearer ${options.token}` },
        signal: options.signal,
      })

      if (response.ok) {
        const body = (await response.json()) as HealthResponse
        return body
      }
      lastError = new Error(`/health returned ${response.status.toString()}`)
    } catch (err) {
      lastError = err
    }

    await delay(intervalMs, undefined, { signal: options.signal })
  }

  const reason = lastError instanceof Error ? lastError.message : 'timeout'
  throw new Error(`/health did not become ready within ${timeoutMs.toString()}ms: ${reason}`)
}
