// @vitest-environment happy-dom
/**
 * Regression test — `downloadBlob` must not revoke the object URL
 * synchronously after the click (Safari/old Firefox abort the download);
 * the revoke happens in a timeout.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadBlob } from '../../src/composables/download'

describe('downloadBlob defers the object-URL revoke', () => {
  let created: string[]
  let revoked: string[]
  let clicks: number

  beforeEach(() => {
    vi.useFakeTimers()
    created = []
    revoked = []
    clicks = 0
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => {
        const url = `blob:mock-${created.length}`
        created.push(url)
        return url
      }),
      revokeObjectURL: vi.fn((url: string) => {
        revoked.push(url)
      })
    })
    // happy-dom's <a>.click() is a no-op; count via the prototype spy.
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      clicks++
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('clicks immediately but revokes only after the timeout', () => {
    downloadBlob(new Blob(['x']), 'export.csv')

    expect(clicks).toBe(1)
    expect(created).toHaveLength(1)
    expect(revoked).toEqual([]) // NOT revoked synchronously

    vi.advanceTimersByTime(1000)
    expect(revoked).toEqual(created)
  })

  it('sets the download file name on the anchor', () => {
    const append = vi.spyOn(document.body, 'appendChild')
    downloadBlob(new Blob(['x']), 'contacts.csv')
    const anchor = append.mock.calls[0][0] as HTMLAnchorElement
    expect(anchor.download).toBe('contacts.csv')
    expect(anchor.href).toBe(created[0])
  })
})
