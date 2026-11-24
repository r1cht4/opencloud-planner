/**
 * Contact list ordering and name rendering from the synced `contacts.*` settings.
 *
 * `contacts.sortBy` chooses the sort key (`firstName` / `lastName`),
 * `contacts.displayOrder` chooses how a row is labelled (`First Last` /
 * `Last, First`). Both are pure functions so the behaviour is testable without a
 * mounted view; `Contacts.vue` only pipes its already-filtered list through them.
 *
 * The stored `displayName` stays the source of truth for `FN`/vCard writes and
 * for the detail pane — the list label is a *view* of the same contact.
 */

import type { Contact } from '../types'
import type { ContactDisplayOrder, ContactSortField } from './schema'

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

/** Sort key for one contact; falls back to `displayName` when the field is empty. */
export function contactSortKey(contact: Contact, sortBy: ContactSortField): string {
  const value = sortBy === 'firstName' ? contact.firstName : contact.lastName
  return (value || contact.displayName || contact.id).trim()
}

/**
 * Label shown in the contact list. `firstLast` keeps the app's historical
 * label (`displayName`), `lastFirst` renders "Last, First" when both names are
 * known and degrades to the stored `displayName` otherwise.
 */
export function contactListLabel(contact: Contact, displayOrder: ContactDisplayOrder): string {
  if (displayOrder !== 'lastFirst') return contact.displayName
  const { firstName, lastName } = contact
  if (!firstName || !lastName) return contact.displayName
  return `${lastName}, ${firstName}`
}

/**
 * Copy of `contacts`, ordered by the configured field. Ties fall back to
 * `displayName`, then to the UID, so the order is stable across reloads.
 */
export function sortContactsForDisplay(contacts: Contact[], sortBy: ContactSortField): Contact[] {
  return contacts.slice().sort((a, b) => {
    const primary = collator.compare(contactSortKey(a, sortBy), contactSortKey(b, sortBy))
    if (primary !== 0) return primary
    return collator.compare(a.displayName || '', b.displayName || '') || a.id.localeCompare(b.id)
  })
}
