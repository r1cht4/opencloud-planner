// @vitest-environment happy-dom
/**
 * `?open=<href>` deep links (reminder / notification clicks) and the
 * settings-backed contact list helpers.
 */
import { describe, expect, it } from 'vitest'
import { openQueryHref, sameResourceHref } from '../../src/setup/openQuery'
import {
  contactListLabel,
  contactSortKey,
  sortContactsForDisplay
} from '../../src/settings/contactList'
import {
  existingCollectionUrl,
  preferredCollectionUrl
} from '../../src/settings/collectionDefaults'
import type { Contact } from '../../src/types'

function contact(partial: Partial<Contact>): Contact {
  return {
    id: 'id',
    displayName: 'Name',
    firstName: '',
    lastName: '',
    emails: [],
    phones: [],
    addresses: [],
    organization: '',
    title: '',
    notes: '',
    ...partial
  }
}

describe('open query', () => {
  it('reads the open href from the route query', () => {
    expect(openQueryHref({ open: 'https://cloud.example/caldav/u/cal/a.ics' })).toBe(
      'https://cloud.example/caldav/u/cal/a.ics'
    )
    expect(openQueryHref({ open: '  ' })).toBeNull()
    expect(openQueryHref({})).toBeNull()
    expect(openQueryHref(undefined)).toBeNull()
    expect(openQueryHref({ open: ['first.ics', 'second.ics'] })).toBe('first.ics')
    expect(openQueryHref({ open: 42 })).toBeNull()
  })

  it('matches the same resource across hosts and path prefixes', () => {
    const stored = 'https://cloud.example/caldav/user-1/personal/meeting-1.ics'

    expect(sameResourceHref(stored, stored)).toBe(true)
    // Different origin (proxy rename) — the path and file name still identify it.
    expect(
      sameResourceHref(stored, 'https://other.example/caldav/user-1/personal/meeting-1.ics')
    ).toBe(true)
    // Only the file name (root-relative href from a notification payload).
    expect(sameResourceHref(stored, 'meeting-1.ics')).toBe(true)
    // Trailing slash differences are irrelevant.
    expect(sameResourceHref(stored, `${stored}/`)).toBe(true)
  })

  it('does not match another resource', () => {
    const stored = 'https://cloud.example/caldav/user-1/personal/meeting-1.ics'
    expect(sameResourceHref(stored, 'https://cloud.example/caldav/user-1/personal/other.ics')).toBe(
      false
    )
    expect(sameResourceHref(undefined, stored)).toBe(false)
    expect(sameResourceHref(stored, null)).toBe(false)
  })
})

describe('contact list from settings', () => {
  const ada = contact({
    id: 'ada',
    displayName: 'Ada Lovelace',
    firstName: 'Ada',
    lastName: 'Lovelace'
  })
  const grace = contact({
    id: 'grace',
    displayName: 'Grace Hopper',
    firstName: 'Grace',
    lastName: 'Hopper'
  })
  const zoe = contact({ id: 'zoe', displayName: 'Zoe Adams', firstName: 'Zoe', lastName: 'Adams' })

  it('contacts sorted by firstName', () => {
    expect(sortContactsForDisplay([ada, grace, zoe], 'firstName').map((c) => c.firstName)).toEqual([
      'Ada',
      'Grace',
      'Zoe'
    ])
    // By last name the middle entry moves.
    expect(sortContactsForDisplay([ada, grace, zoe], 'lastName').map((c) => c.lastName)).toEqual([
      'Adams',
      'Hopper',
      'Lovelace'
    ])
  })

  it('sorts case-insensitively and falls back to the display name', () => {
    const lower = contact({ id: 'l', displayName: 'zoe', firstName: 'zoe', lastName: 'zoe' })
    expect(sortContactsForDisplay([lower, ada], 'firstName').map((c) => c.id)).toEqual(['ada', 'l'])
    const nameless = contact({ id: 'n', displayName: 'Mallory', firstName: '', lastName: '' })
    expect(contactSortKey(nameless, 'firstName')).toBe('Mallory')
  })

  it('display order only changes the label, never the stored name', () => {
    expect(contactListLabel(ada, 'firstLast')).toBe('Ada Lovelace')
    expect(contactListLabel(ada, 'lastFirst')).toBe('Lovelace, Ada')
    // No first/last name → the stored display name is shown unchanged.
    const single = contact({ id: 's', displayName: 'ACME Support', firstName: '', lastName: '' })
    expect(contactListLabel(single, 'lastFirst')).toBe('ACME Support')
    // The objects themselves are untouched.
    expect(ada.displayName).toBe('Ada Lovelace')
  })

  it('prefers the configured collection only while it still exists', () => {
    const collections = [{ url: '/caldav/u/a/' }, { url: '/caldav/u/b/' }]

    expect(preferredCollectionUrl('/caldav/u/b/', collections)).toBe('/caldav/u/b/')
    // Deleted/shared-away collection → first one, never a dead URL.
    expect(preferredCollectionUrl('/caldav/u/gone/', collections)).toBe('/caldav/u/a/')
    expect(preferredCollectionUrl(undefined, collections)).toBe('/caldav/u/a/')
    expect(existingCollectionUrl('/caldav/u/gone/', collections)).toBe('')
    // Trailing slashes are not significant.
    expect(existingCollectionUrl('/caldav/u/a', collections)).toBe('/caldav/u/a/')
    expect(preferredCollectionUrl(undefined, [])).toBe('')
  })
})
