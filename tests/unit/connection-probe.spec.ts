// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@opencloud-eu/web-pkg', () => ({
  useAuthStore: () => ({ accessToken: 'test-token' })
}))

import {
  caldavProbeUrl,
  PROBE_TIMEOUT_MS,
  probeDav,
  probeOutcomeForStatus,
  resetConnectionProbe,
  useConnectionProbe,
  type ProbeOutcome
} from '../../src/composables/useConnectionProbe'

beforeEach(() => {
  resetConnectionProbe()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('probeOutcomeForStatus', () => {
  it('probe maps statuses', () => {
    const cases: Array<[number | null | undefined, ProbeOutcome]> = [
      [207, 'ok'],
      [404, 'not-configured'],
      [405, 'not-configured'],
      [502, 'unavailable'],
      [503, 'unavailable'],
      [504, 'unavailable'],
      // No response at all (DNS, connection refused, TLS) = backend not there.
      [null, 'unavailable'],
      [undefined, 'unavailable'],
      [401, 'unauthorized'],
      [403, 'unauthorized'],
      [200, 'error'],
      [500, 'error'],
      [418, 'error']
    ]

    for (const [status, expected] of cases) {
      expect(probeOutcomeForStatus(status), `status ${status}`).toBe(expected)
    }
  })
})

describe('probeDav', () => {
  it('PROPFINDs the CalDAV base with Depth 0 and reports ok', async () => {
    const fetchMock = vi.fn(async () => ({ status: 207 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await probeDav()

    expect(result).toEqual({ outcome: 'ok' })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${window.location.origin}/caldav/`)
    expect(url).toBe(caldavProbeUrl())
    expect(init.method).toBe('PROPFIND')
    expect(new Headers(init.headers).get('Depth')).toBe('0')
    expect(String(init.body)).toContain('<d:propfind')
  })

  it('bounds the request so a hanging proxy cannot block the app forever', async () => {
    const fetchMock = vi.fn(async () => ({ status: 207 }))
    vi.stubGlobal('fetch', fetchMock)

    await probeDav()

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    // `AbortSignal.timeout` exists in the target browsers (and in Node ≥ 18).
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(PROBE_TIMEOUT_MS).toBeGreaterThan(0)
  })

  it('keeps the HTTP status of a missing route', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ status: 404 }))
    )

    expect(await probeDav()).toEqual({
      outcome: 'not-configured',
      status: 404,
      detail: 'HTTP 404'
    })
  })

  it('reports a dead proxy as unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ status: 503 }))
    )

    expect(await probeDav()).toMatchObject({ outcome: 'unavailable', status: 503 })
  })

  it('classifies a network failure as unavailable instead of throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      })
    )

    const result = await probeDav()

    expect(result.outcome).toBe('unavailable')
    expect(result.status).toBeUndefined()
    expect(result.detail).toContain('Failed to fetch')
  })
})

describe('useConnectionProbe', () => {
  it('starts pending and exposes the outcome after retest', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ status: 207 }))
    )
    const { outcome, probing, retest, lastResult } = useConnectionProbe()

    expect(outcome.value).toBe('pending')
    expect(probing.value).toBe(false)
    expect(lastResult.value).toBeNull()

    const running = retest()
    expect(probing.value).toBe(true)
    await running

    expect(outcome.value).toBe('ok')
    expect(probing.value).toBe(false)
    expect(lastResult.value).toEqual({ outcome: 'ok' })
  })

  it('shares one request between concurrent retests', async () => {
    const fetchMock = vi.fn(async () => ({ status: 207 }))
    vi.stubGlobal('fetch', fetchMock)
    const { retest } = useConnectionProbe()

    await Promise.all([retest(), retest()])

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps the previous outcome while a retest is running', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ status: 207 }))
    )
    const { outcome, retest } = useConnectionProbe()
    await retest()

    let release: (value: { status: number }) => void = () => undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<{ status: number }>((resolve) => {
            release = resolve
          })
      )
    )

    const running = retest()
    expect(outcome.value).toBe('ok')

    release({ status: 502 })
    await running
    expect(outcome.value).toBe('unavailable')
  })
})
