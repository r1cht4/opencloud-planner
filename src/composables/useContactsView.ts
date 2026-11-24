/**
 * useContactsView – the Contacts page's state + DAV logic.
 *
 * Extracted from `views/Contacts.vue`: address-book selection (incl. the
 * `contacts.defaultAddressBook` default that can arrive late with the settings),
 * the sorted/labelled list, the detail-pane selection with keyboard navigation,
 * live refresh (`useCollectionSync`) and the save/delete writes with the
 * ETag-conflict handling.
 *
 * The service's English error strings are mapped to translated messages
 * (`davErrorMessages`) before they reach the banner.
 * The contact form dialog itself is `components/contacts/ContactDialog.vue`.
 */

import { computed, nextTick, ref, watch, type Ref } from 'vue'
import { useGettext } from 'vue3-gettext'
import { useMessages, useModals } from '@opencloud-eu/web-pkg'
import { useDAVClient } from './useDAVClient'
import { useContactsService } from './useContactsService'
import { useCollectionSync } from './useCollectionSync'
import { isConflictErrorMessage, mapDavError } from './davErrorMessages'
import { useSettings } from '../settings/settingsStore'
import { contactListLabel, sortContactsForDisplay } from '../settings/contactList'
import { avatarColor, contactInitials } from './contactAvatar'
import { existingCollectionUrl } from '../settings/collectionDefaults'
import type { AddressBook, Contact } from '../types'

export interface ContactsViewState {
  addressBooks: Ref<AddressBook[]>
  contacts: Ref<Contact[]>
  filteredContacts: Ref<Contact[]>
  searchQuery: Ref<string>
  loading: Ref<boolean>
  error: Ref<string | null>
  /** Translated banner text for the service error. */
  errorMessage: Ref<string | null>
  displayContacts: Ref<Contact[]>
  selectedAddressBook: Ref<AddressBook | null>
  selectedContact: Ref<Contact | null>
  initialized: Ref<boolean>
  showDialog: Ref<boolean>
  editMode: Ref<boolean>
  editingContact: Ref<Contact | null>
  contactLabel: (contact: Contact) => string
  initials: (name: string) => string
  avatarColor: (name: string) => string
  loadInitial: () => Promise<void>
  selectContact: (contact: Contact) => void
  closeContactDetail: () => void
  navigateContacts: (direction: -1 | 1, currentIdx: number) => Promise<void>
  onAddressBookChange: (book: AddressBook) => Promise<void>
  openCreateDialog: () => void
  openEditDialog: (contact: Contact) => void
  closeDialog: () => void
  onSaveContact: (data: Omit<Contact, 'rawVcard' | 'href' | 'etag'>) => Promise<void>
  onDeleteContact: (contact: Contact) => void
}

export function useContactsView(): ContactsViewState {
  const { $gettext } = useGettext()
  const { dispatchModal } = useModals()
  const { showMessage, showErrorMessage } = useMessages()
  const { ensureReady } = useDAVClient()
  const {
    addressBooks,
    contacts,
    filteredContacts,
    loading,
    error,
    searchQuery,
    fetchAddressBooks,
    fetchContacts,
    createContact,
    updateContact,
    deleteContact
  } = useContactsService()
  const { settings, loaded: settingsLoaded } = useSettings()

  /**
   * List order/labels from the synced `contacts.*` settings: `sortBy` picks the
   * sort key, `displayOrder` only the label (the stored `FN`/`displayName` never
   * changes, so saves stay lossless).
   */
  const displayContacts = computed(() =>
    sortContactsForDisplay(filteredContacts.value, settings.value.contacts.sortBy)
  )

  function contactLabel(contact: Contact): string {
    return contactListLabel(contact, settings.value.contacts.displayOrder)
  }

  const selectedAddressBook = ref<AddressBook | null>(null)
  const selectedContact = ref<Contact | null>(null)
  const initialized = ref(false)
  const showDialog = ref(false)
  const editMode = ref(false)
  const editingContact = ref<Contact | null>(null)

  /** The service's English error strings are mapped to translated messages. */
  const errorMessage = computed(() => mapDavError(error.value, $gettext))

  async function loadInitial(): Promise<void> {
    const ready = await ensureReady('contacts')
    if (!ready) return
    const books = await fetchAddressBooks()
    if (books.length > 0) {
      // `contacts.defaultAddressBook` when it still exists, else the first one.
      const preferred =
        existingCollectionUrl(settings.value.contacts.defaultAddressBook, books) || books[0].url
      selectedAddressBook.value = books.find((book) => book.url === preferred) || books[0]
      await fetchContacts(preferred)
      initialized.value = true
    }
    // Baseline the change markers with what is now on screen, so the poll only
    // reports changes that happen after this point.
    void markSynced()
  }

  function selectContact(c: Contact) {
    selectedContact.value = c
  }

  function closeContactDetail() {
    selectedContact.value = null
  }

  async function navigateContacts(direction: -1 | 1, currentIdx: number) {
    const list = displayContacts.value
    const nextIdx = currentIdx + direction
    if (nextIdx < 0 || nextIdx >= list.length) return
    selectContact(list[nextIdx])
    await nextTick()
    // Focus the newly selected row
    const listEl = document.querySelector('.contact-list')
    const rows = listEl?.querySelectorAll<HTMLElement>('.contact-row')
    rows?.[nextIdx]?.focus()
  }

  async function switchToAddressBook(book: AddressBook) {
    selectedAddressBook.value = book
    selectedContact.value = null
    await fetchContacts(book.url)
  }

  async function onAddressBookChange(book: AddressBook) {
    addressBookPickedByUser = true
    await switchToAddressBook(book)
  }

  /** True once the user picked a book himself — his choice wins over the default. */
  let addressBookPickedByUser = false

  /**
   * Switch to `contacts.defaultAddressBook` when it still exists. Settings load
   * asynchronously (one PROPFIND per session), so the stored default can arrive
   * after the first render.
   */
  function applyDefaultAddressBook(): void {
    const wanted = existingCollectionUrl(
      settings.value.contacts.defaultAddressBook,
      addressBooks.value
    )
    if (!wanted || wanted === selectedAddressBook.value?.url) return
    const book = addressBooks.value.find((entry) => entry.url === wanted)
    if (book) void switchToAddressBook(book)
  }

  watch(settingsLoaded, (isLoaded) => {
    if (isLoaded && !addressBookPickedByUser) applyDefaultAddressBook()
  })

  async function refreshSelectedAddressBook() {
    if (!selectedAddressBook.value) return
    const previousId = selectedContact.value?.id
    const latest = await fetchContacts(selectedAddressBook.value.url)
    // Keep the selection by UID when the contact still exists; a contact deleted
    // by another client simply clears the detail pane.
    selectedContact.value = previousId ? latest.find((c) => c.id === previousId) || null : null
  }

  /**
   * Pick up changes made by other clients (phone, Thunderbird, …) without a
   * reload: poll the address-book change markers (ctag/sync-token) while the tab
   * is visible, on focus and when the tab becomes visible again, and refetch the
   * address books that actually changed. Silent — no toast.
   */
  const { markSynced } = useCollectionSync({
    getCollections: () => addressBooks.value.map((book) => book.url),
    onChanged: async (urls) => {
      // Only the visible address book holds loaded contacts; other books are
      // reloaded when the user switches to them.
      const current = selectedAddressBook.value
      if (!current || !urls.includes(current.url)) return
      await refreshSelectedAddressBook()
    }
  })

  /** Re-read the marker of the visible address book after our own write. */
  async function markOwnWrite() {
    const current = selectedAddressBook.value
    if (current) await markSynced([current.url])
  }

  /** The 412 conflict identifier on the service `error` ref. */
  function isConflictError(): boolean {
    return isConflictErrorMessage(error.value)
  }

  function openCreateDialog() {
    editMode.value = false
    editingContact.value = null
    showDialog.value = true
  }

  function openEditDialog(contact: Contact) {
    editMode.value = true
    editingContact.value = contact
    showDialog.value = true
  }

  function closeDialog() {
    showDialog.value = false
    editMode.value = false
    editingContact.value = null
  }

  async function onSaveContact(data: Omit<Contact, 'rawVcard' | 'href' | 'etag'>) {
    if (editMode.value && editingContact.value) {
      const updated: Contact = { ...editingContact.value, ...data }
      const ok = await updateContact(updated)
      const conflict = !ok && isConflictError()
      if (ok) {
        selectedContact.value = contacts.value.find((c) => c.id === updated.id) || updated
        showMessage({ title: $gettext('Contact updated') })
        closeDialog()
        await markOwnWrite()
      } else {
        await refreshSelectedAddressBook()
        if (conflict) {
          showErrorMessage({
            title:
              mapDavError(error.value, $gettext) ??
              $gettext('Item was modified elsewhere. Latest version loaded.')
          })
        } else {
          showErrorMessage({
            title: mapDavError(error.value, $gettext) ?? $gettext('Failed to update contact')
          })
        }
        if (conflict) closeDialog()
      }
    } else {
      const bookUrl = selectedAddressBook.value?.url
      if (!bookUrl) return
      const created = await createContact(bookUrl, data)
      if (created) {
        selectedContact.value = created
        showMessage({ title: $gettext('Contact created') })
        closeDialog()
        await markOwnWrite()
      } else {
        showErrorMessage({
          title: mapDavError(error.value, $gettext) ?? $gettext('Failed to create contact')
        })
      }
    }
  }

  function onDeleteContact(contact: Contact) {
    dispatchModal({
      title: $gettext('Delete contact'),
      message: $gettext('Are you sure you want to delete this contact?'),
      confirmText: $gettext('Delete'),
      async onConfirm() {
        const ok = await deleteContact(contact)
        const conflict = !ok && isConflictError()
        if (ok) {
          if (selectedContact.value?.id === contact.id) selectedContact.value = null
          showMessage({ title: $gettext('Contact deleted') })
          await markOwnWrite()
        } else {
          await refreshSelectedAddressBook()
          if (conflict) {
            showErrorMessage({
              title:
                mapDavError(error.value, $gettext) ??
                $gettext('Item was modified elsewhere. Latest version loaded.')
            })
          } else {
            showErrorMessage({
              title: mapDavError(error.value, $gettext) ?? $gettext('Failed to delete contact')
            })
          }
        }
      }
    })
  }

  return {
    addressBooks,
    contacts,
    filteredContacts,
    searchQuery,
    loading,
    error,
    errorMessage,
    displayContacts,
    selectedAddressBook,
    selectedContact,
    initialized,
    showDialog,
    editMode,
    editingContact,
    contactLabel,
    initials: contactInitials,
    avatarColor,
    loadInitial,
    selectContact,
    closeContactDetail,
    navigateContacts,
    onAddressBookChange,
    openCreateDialog,
    openEditDialog,
    closeDialog,
    onSaveContact,
    onDeleteContact
  }
}
