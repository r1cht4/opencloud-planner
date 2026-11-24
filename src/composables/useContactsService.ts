/**
 * useContactsService – CardDAV operations using direct fetch.
 *
 * The pure vCard parsing/serialisation helpers live in `src/vcard/vcard.ts`;
 * they are re-exported below so existing importers keep using this path.
 */

import { ref, computed, type Ref } from 'vue'
import { useDAVClient, davFetch, davResourceName } from './useDAVClient'
import { createCollection, formatIfMatch } from './useCalendarService'
import { davPropData, davPropText, parseMultistatus } from './davXml'
import { discoverCollections } from './davCollections'
import { parseVcard, buildVcard, patchVcard } from '../vcard/vcard'
import type { AddressBook, Contact } from '../types'

export {
  safePhotoSrc,
  escapeVcardText,
  unescapeVcardText,
  parseVcard,
  buildVcard,
  patchVcard
} from '../vcard/vcard'

async function addressbookQuery(addressBookUrl: string): Promise<string> {
  const body = `<?xml version="1.0" encoding="utf-8"?>
<card:addressbook-query xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">
  <d:prop>
    <d:getetag/>
    <card:address-data/>
  </d:prop>
</card:addressbook-query>`

  const resp = await davFetch(addressBookUrl, {
    method: 'REPORT',
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      Depth: '1'
    },
    body
  })
  if (!resp.ok && resp.status !== 207) {
    throw new Error(`REPORT addressbook-query failed: ${resp.status}`)
  }
  return resp.text()
}

export function useContactsService() {
  const { ensureReady, getState } = useDAVClient()

  const addressBooks: Ref<AddressBook[]> = ref([])
  const contacts: Ref<Contact[]> = ref([])
  const error: Ref<string | null> = ref(null)
  const searchQuery = ref('')

  // Counter-backed like useCalendarService: several address books can be
  // fetched at once, so a boolean would report "done" after the first one.
  const inFlight = ref(0)
  const loading = computed(() => inFlight.value > 0)

  /**
   * Error policy (parallel-safe): `error` is cleared only when a *fresh*
   * top-level operation starts (nothing else in flight), never by a concurrent
   * sibling's start, and never by a successful call. See useCalendarService.
   */
  function beginOperation(): void {
    if (inFlight.value === 0) error.value = null
    inFlight.value++
  }

  function endOperation(): void {
    if (inFlight.value > 0) inFlight.value--
  }

  // Sort once per contacts change; the per-keystroke filter then preserves order.
  const sortedContacts = computed(() =>
    contacts.value.slice().sort((a, b) => a.displayName.localeCompare(b.displayName))
  )

  const filteredContacts = computed(() => {
    const q = searchQuery.value.toLowerCase().trim()
    if (!q) return sortedContacts.value
    return sortedContacts.value.filter(
      (c) =>
        c.displayName.toLowerCase().includes(q) ||
        c.firstName.toLowerCase().includes(q) ||
        c.lastName.toLowerCase().includes(q) ||
        c.organization.toLowerCase().includes(q) ||
        c.emails.some((e) => e.value.toLowerCase().includes(q)) ||
        c.phones.some((p) => p.value.includes(q))
    )
  })

  async function fetchAddressBooks(): Promise<AddressBook[]> {
    beginOperation()
    try {
      if (!(await ensureReady('contacts'))) throw new Error('DAV server not reachable')
      const state = getState('contacts')!
      const origin = new URL(state.baseUrl).origin

      // Shared discovery (`davCollections`): resourcetype + displayname, one
      // PROPFIND per home set, only <addressbook/> collections come back.
      const books: AddressBook[] = (
        await discoverCollections('addressbook', state.principalUrl, { origin })
      ).map((collection) => ({
        url: collection.url,
        displayName: collection.displayName || 'Contacts',
        description: collection.description,
        ctag: collection.ctag
      }))

      // Auto-create default addressbook if none exist
      if (books.length === 0) {
        const abUrl = `${state.principalUrl}default-contacts/`
        await createCollection(abUrl, 'addressbook', 'Contacts')
        books.push({ url: abUrl, displayName: 'Contacts', description: '', ctag: '' })
      }

      addressBooks.value = books
      return books
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      console.error('[planner] fetchAddressBooks error:', err)
      return []
    } finally {
      endOperation()
    }
  }

  async function fetchContacts(addressBookUrl: string): Promise<Contact[]> {
    beginOperation()
    try {
      if (!(await ensureReady('contacts'))) throw new Error('DAV server not reachable')
      const state = getState('contacts')!
      const origin = new URL(state.baseUrl).origin

      const xml = await addressbookQuery(addressBookUrl)
      const responses = parseMultistatus(xml)
      const parsed: Contact[] = []

      for (const resp of responses) {
        if (resp.href === addressBookUrl || resp.href.endsWith('/')) continue
        if (!resp.href.endsWith('.vcf')) continue

        const objUrl = resp.href.startsWith('http') ? resp.href : `${origin}${resp.href}`
        const etag = davPropText(resp.el, 'getetag') || undefined
        const vcardData = davPropData(resp.el, 'address-data')
        if (!vcardData) continue

        try {
          const contact = parseVcard(vcardData)
          contact.href = objUrl
          contact.etag = etag
          parsed.push(contact)
        } catch {
          /* skip malformed */
        }
      }

      contacts.value = parsed
      return parsed
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      return []
    } finally {
      endOperation()
    }
  }

  async function createContact(
    addressBookUrl: string,
    contact: Omit<Contact, 'rawVcard' | 'href' | 'etag'>
  ): Promise<Contact | null> {
    try {
      if (!(await ensureReady('contacts'))) throw new Error('DAV server not reachable')
      const vcard = buildVcard(contact as Contact)
      // Safe resource name (UID as-is when safe, else its SHA-256).
      const url = `${addressBookUrl}${await davResourceName(contact.id)}.vcf`

      const resp = await davFetch(url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'text/vcard; charset=utf-8',
          'If-None-Match': '*'
        },
        body: vcard
      })

      if (!resp.ok) throw new Error(`PUT failed: ${resp.status}`)
      const etag = resp.headers.get('ETag') || undefined
      const created: Contact = { ...(contact as Contact), rawVcard: vcard, href: url, etag }
      contacts.value.push(created)
      return created
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      return null
    }
  }

  /**
   * PUT an externally produced vCard verbatim (import path). 412 means the UID
   * already exists — reported as 'exists' so the caller can count skips.
   */
  async function importContactVcard(
    addressBookUrl: string,
    uid: string,
    vcard: string
  ): Promise<'created' | 'exists' | 'failed'> {
    try {
      if (!(await ensureReady('contacts'))) throw new Error('DAV server not reachable')
      // `uid` is kept in the data; the resource name is its safe form.
      const resp = await davFetch(`${addressBookUrl}${await davResourceName(uid)}.vcf`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'text/vcard; charset=utf-8',
          'If-None-Match': '*'
        },
        body: vcard
      })
      if (resp.status === 412) return 'exists'
      if (!resp.ok) throw new Error(`PUT failed: ${resp.status}`)
      return 'created'
    } catch (err) {
      console.warn('[planner] Import PUT failed:', uid, err)
      return 'failed'
    }
  }

  async function updateContact(contact: Contact): Promise<boolean> {
    try {
      if (!(await ensureReady('contacts'))) throw new Error('DAV server not reachable')
      // Patch the original rawVcard to preserve unmanaged properties (IMPP,
      // X-SOCIALPROFILE, X-* custom fields, etc.). Fall back to a full rebuild
      // only when no raw vCard is available (e.g. contacts created locally
      // before rawVcard round-trip was introduced).
      const vcard = contact.rawVcard ? patchVcard(contact.rawVcard, contact) : buildVcard(contact)
      const url = contact.href || ''

      const headers: Record<string, string> = {
        'Content-Type': 'text/vcard; charset=utf-8'
      }
      if (contact.etag) headers['If-Match'] = formatIfMatch(contact.etag)

      const resp = await davFetch(url, { method: 'PUT', headers, body: vcard })
      if (resp.status === 412) {
        error.value = 'Item was modified elsewhere; refresh and try again.'
        return false
      }
      if (!resp.ok) throw new Error(`PUT failed: ${resp.status}`)

      const idx = contacts.value.findIndex((c) => c.id === contact.id)
      if (idx !== -1)
        contacts.value[idx] = {
          ...contact,
          rawVcard: vcard,
          etag: resp.headers.get('ETag') || contact.etag
        }
      return true
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      return false
    }
  }

  async function deleteContact(contact: Contact): Promise<boolean> {
    try {
      if (!(await ensureReady('contacts'))) throw new Error('DAV server not reachable')
      const url = contact.href || ''

      const headers: Record<string, string> = {}
      if (contact.etag) headers['If-Match'] = formatIfMatch(contact.etag)

      const resp = await davFetch(url, { method: 'DELETE', headers })
      if (resp.status === 412) {
        error.value = 'Item was modified elsewhere; refresh and try again.'
        return false
      }
      if (!resp.ok) throw new Error(`DELETE failed: ${resp.status}`)
      contacts.value = contacts.value.filter((c) => c.id !== contact.id)
      return true
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      return false
    }
  }

  return {
    addressBooks,
    contacts,
    filteredContacts,
    loading,
    error,
    searchQuery,
    fetchAddressBooks,
    fetchContacts,
    createContact,
    importContactVcard,
    updateContact,
    deleteContact
  }
}
