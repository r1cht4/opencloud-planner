// @vitest-environment happy-dom
/**
 * Tests for `src/composables/davErrorMessages.ts`: the service error
 * strings stay as identifiers, the views show translated messages.
 */
import { describe, expect, it } from 'vitest'
import {
  DAV_ERROR,
  isConflictErrorMessage,
  mapDavError
} from '../../src/composables/davErrorMessages'

const $gettext = (text: string) => `⟪${text}⟫`

describe('isConflictErrorMessage', () => {
  it('recognises the 412 identifier', () => {
    expect(isConflictErrorMessage('Item was modified elsewhere; refresh and try again.')).toBe(true)
    expect(isConflictErrorMessage('PUT failed: 500')).toBe(false)
    expect(isConflictErrorMessage(null)).toBe(false)
    expect(isConflictErrorMessage(undefined)).toBe(false)
  })
})

describe('mapDavError', () => {
  it('maps the conflict identifier to the conflict message', () => {
    expect(mapDavError('Item was modified elsewhere; refresh and try again.', $gettext)).toBe(
      '⟪Item was modified elsewhere. Latest version loaded.⟫'
    )
  })

  it('maps the unreachable identifier to the Radicale hint', () => {
    expect(mapDavError('DAV server not reachable', $gettext)).toBe(
      '⟪The calendar server is not reachable. Try again.⟫'
    )
  })

  it('maps unknown technical strings to the generic message', () => {
    expect(mapDavError('PUT failed: 500', $gettext)).toBe(
      '⟪The request to the calendar server failed. Please try again.⟫'
    )
    expect(mapDavError('REPORT calendar-query failed: 507', $gettext)).toBe(
      '⟪The request to the calendar server failed. Please try again.⟫'
    )
  })

  it('returns null when there is no error', () => {
    expect(mapDavError(null, $gettext)).toBeNull()
    expect(mapDavError('', $gettext)).toBeNull()
    expect(mapDavError(undefined, $gettext)).toBeNull()
  })

  it('exposes the identifiers the services use', () => {
    expect(DAV_ERROR.conflict).toBe('modified elsewhere')
    expect(DAV_ERROR.unreachable).toBe('DAV server not reachable')
  })
})
