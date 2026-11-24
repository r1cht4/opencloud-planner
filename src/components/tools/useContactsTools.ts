/**
 * useContactsTools – script logic for the two contacts halves of Settings → Data
 * (`ContactsToolsCard.vue` with `part="import"` and `part="cleanup"`).
 *
 * The component keeps only its markup, the props and this composable's bindings.
 *
 * `lazy` skips the initial load: the cleanup half reads the address books the first
 * time its collapsed "Clean up" section is opened (it shows its own address-book
 * selector there), so rendering the Data tab does not fetch the same collections
 * twice.
 *
 * The birthday sync used to live here; it moved to Settings → Contacts → Birthdays
 * (`BirthdaysSettings.vue`), next to the switch that enables it.
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useGettext } from 'vue3-gettext'
import { useMessages } from '@opencloud-eu/web-pkg'
import { useDAVClient } from '../../composables/useDAVClient'
import {
  isOversizedImportFile,
  isOversizedImportText,
  oversizedImportMessage
} from '../../composables/importFileLimits'
import { useContactsService } from '../../composables/useContactsService'
import { collectionSlug, type VcardImportItem } from '../../composables/importExport'
import { useImport, type ImportCounts, type ImportTarget } from '../../composables/useImport'
import { useModalA11y } from '../../composables/useModalA11y'
import type { Contact } from '../../types'

export function useContactsTools(
  props: { refreshKey?: number },
  options: { lazy?: boolean; onChanged?: () => void } = {}
) {
  const { $gettext } = useGettext()
  const { showMessage, showErrorMessage } = useMessages()
  const { ensureReady } = useDAVClient()
  const { addressBooks, contacts, fetchAddressBooks, fetchContacts, updateContact, deleteContact } =
    useContactsService()
  const { prepareImport } = useImport()

  const selectedAddressBookUrl = ref<string>('')
  const contactsFileInput = ref<HTMLInputElement | null>(null)
  /** True once the address books of this instance were read at least once. */
  const addressBooksLoaded = ref(false)
  let loadRequest: Promise<void> | null = null

  /**
   * Read the address books and the contacts of the selected one. Single flight:
   * the lazy half asks for the list both from its section and from "Merge
   * duplicates", and two PROPFINDs in a row are pointless.
   */
  async function loadAddressBooks(): Promise<void> {
    if (loadRequest) return loadRequest
    loadRequest = (async () => {
      if (!(await ensureReady('contacts'))) return
      const books = await fetchAddressBooks()
      addressBooksLoaded.value = true
      const stillThere = books.some((b) => b.url === selectedAddressBookUrl.value)
      if (!stillThere) selectedAddressBookUrl.value = books[0]?.url || ''
      if (selectedAddressBookUrl.value) await fetchContacts(selectedAddressBookUrl.value)
    })()
    try {
      await loadRequest
    } finally {
      loadRequest = null
    }
  }

  // ── Lazy loading (Clean up half) ─────────────────────────────────────────────

  /** Root of the rendered half, used to find the collapsible section around it. */
  const halfElement = ref<HTMLElement | null>(null)
  let detachSection: (() => void) | null = null

  /**
   * The cleanup half sits inside the collapsed "Clean up" section, and it shows
   * the address-book selector before "Merge duplicates" is pressed — so the list
   * is read when that section is opened rather than when the Data tab renders.
   */
  function armLazyLoad(): void {
    const section = halfElement.value?.closest('details') ?? null
    if (!section) return
    if (section.open) {
      void loadAddressBooks()
      return
    }
    const onToggle = (): void => {
      if (!section.open) return
      detachSection?.()
      void loadAddressBooks()
    }
    section.addEventListener('toggle', onToggle)
    detachSection = () => section.removeEventListener('toggle', onToggle)
  }

  onMounted(() => {
    if (options.lazy) {
      armLazyLoad()
      return
    }
    void loadAddressBooks()
  })

  onUnmounted(() => {
    detachSection?.()
  })

  watch(
    () => props.refreshKey,
    () => {
      // The lazy half must not fetch what it never needed.
      if (options.lazy && !addressBooksLoaded.value) return
      void loadAddressBooks()
    }
  )

  // ── Address book change ──────────────────────────────────────────────────────
  async function onAddressBookChange() {
    if (selectedAddressBookUrl.value) await fetchContacts(selectedAddressBookUrl.value)
  }

  // ── Export ───────────────────────────────────────────────────────────────────

  function downloadFile(content: string, filename: string, mime: string) {
    const blob = new Blob([content], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  function exportContacts() {
    const vcards = contacts.value
      .filter((c) => c.rawVcard)
      .map((c) => c.rawVcard)
      .join('\r\n')
    if (!vcards) {
      showMessage({ title: $gettext('Nothing to export') })
      return
    }
    const book = addressBooks.value.find((b) => b.url === selectedAddressBookUrl.value)
    downloadFile(vcards, `${collectionSlug(book?.displayName || 'contacts')}.vcf`, 'text/vcard')
  }

  // ── Import (target dialog + verbatim PUT) ────────────────────────────────────
  const showImportDialog = ref(false)
  const importItems = ref<VcardImportItem[]>([])
  const importSuggestedName = ref('')
  const importInitialTargetUrl = ref('')

  const importTargets = computed<ImportTarget[]>(() =>
    addressBooks.value.map((b) => ({ url: b.url, displayName: b.displayName }))
  )

  async function importContacts(e: Event) {
    const input = e.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    input.value = ''

    // Refuse huge files instead of parsing them on the main thread.
    if (isOversizedImportFile(file)) {
      showErrorMessage({ title: oversizedImportMessage($gettext) })
      return
    }
    const text = await file.text()
    if (isOversizedImportText(text)) {
      showErrorMessage({ title: oversizedImportMessage($gettext) })
      return
    }

    const prepared = await prepareImport('contacts', text, file.name)
    if (!prepared) return
    importItems.value = prepared.items as VcardImportItem[]
    importSuggestedName.value = prepared.suggestedName
    importInitialTargetUrl.value = selectedAddressBookUrl.value || addressBooks.value[0]?.url || ''
    showImportDialog.value = true
  }

  async function onImported(counts: ImportCounts) {
    showImportDialog.value = false
    await fetchAddressBooks()
    addressBooksLoaded.value = true
    const targetUrl = counts.targetUrl
    if (targetUrl && addressBooks.value.some((b) => b.url === targetUrl)) {
      selectedAddressBookUrl.value = targetUrl
    }
    if (selectedAddressBookUrl.value) await fetchContacts(selectedAddressBookUrl.value)
    // The other halves of the tab (collections, clean up) show stale data now.
    options.onChanged?.()
  }

  // ── Merge flow ───────────────────────────────────────────────────────────────
  const mergePanelRef = ref<HTMLElement | null>(null)
  const showMergeDialog = ref(false)
  const mergeGroups = ref<Contact[][]>([])
  const mergeCurrentIdx = ref(0)
  const mergeKeep = ref<number>(0)
  const mergeFields = ref<Set<string>>(new Set())

  function closeMergeDialog() {
    showMergeDialog.value = false
  }

  useModalA11y(mergePanelRef, showMergeDialog, { onClose: closeMergeDialog })

  const mergeCurrentGroup = computed(() => mergeGroups.value[mergeCurrentIdx.value] || [])
  const mergeOther = computed(() => {
    const group = mergeCurrentGroup.value
    return group.filter((_, i) => i !== mergeKeep.value)
  })
  const mergeAvailableFields = computed(() => {
    const others = mergeOther.value
    const primary = mergeCurrentGroup.value[mergeKeep.value]
    if (!primary || !others.length) return []
    const fields: Array<{ key: string; label: string; value: string }> = []
    for (const other of others) {
      if (!primary.emails.length && other.emails.length)
        fields.push({
          key: `emails-${other.id}`,
          label: $gettext('Email'),
          value: other.emails.map((e) => e.value).join(', ')
        })
      if (!primary.phones.length && other.phones.length)
        fields.push({
          key: `phones-${other.id}`,
          label: $gettext('Phone'),
          value: other.phones.map((p) => p.value).join(', ')
        })
      if (!primary.addresses.length && other.addresses.length)
        fields.push({
          key: `addresses-${other.id}`,
          label: $gettext('Address'),
          value: [other.addresses[0]?.street, other.addresses[0]?.city].filter(Boolean).join(', ')
        })
      if (!primary.organization && other.organization)
        fields.push({
          key: `organization-${other.id}`,
          label: $gettext('Organization'),
          value: other.organization
        })
      if (!primary.title && other.title)
        fields.push({ key: `title-${other.id}`, label: $gettext('Job title'), value: other.title })
      if (!primary.birthday && other.birthday)
        fields.push({
          key: `birthday-${other.id}`,
          label: $gettext('Birthday'),
          value: other.birthday
        })
      if (!primary.photo && other.photo)
        fields.push({ key: `photo-${other.id}`, label: $gettext('Photo'), value: '(photo)' })
      if (!primary.notes && other.notes)
        fields.push({
          key: `notes-${other.id}`,
          label: $gettext('Notes'),
          value: other.notes.substring(0, 40)
        })
      if (!primary.categories?.length && other.categories?.length)
        fields.push({
          key: `categories-${other.id}`,
          label: $gettext('Categories'),
          value: other.categories.join(', ')
        })
    }
    return fields
  })

  async function mergeDuplicates() {
    // Re-read on every press: an import in the other half (or any change from
    // another client) is not in the contacts fetched the last time.
    if (!addressBooksLoaded.value || !selectedAddressBookUrl.value) await loadAddressBooks()
    else await fetchContacts(selectedAddressBookUrl.value)
    const all = contacts.value
    const groups = new Map<string, Contact[]>()

    for (const c of all) {
      const key = c.displayName.trim().toLowerCase()
      if (!key) continue
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(c)
    }

    for (const c of all) {
      for (const email of c.emails) {
        const key = `email:${email.value.trim().toLowerCase()}`
        if (!key || key === 'email:') continue
        if (!groups.has(key)) groups.set(key, [])
        const group = groups.get(key)!
        if (!group.includes(c)) group.push(c)
      }
    }

    const duplicateGroups = [...groups.values()].filter((g) => g.length > 1)
    // Deduplicate groups that share the same contacts
    const uniqueGroups: Contact[][] = []
    const usedIds = new Set<string>()
    for (const group of duplicateGroups) {
      const key = group
        .map((c) => c.id)
        .sort()
        .join(',')
      if (usedIds.has(key)) continue
      usedIds.add(key)
      uniqueGroups.push(group)
    }

    if (uniqueGroups.length === 0) {
      showMessage({ title: $gettext('No duplicates found') })
      return
    }

    mergeGroups.value = uniqueGroups
    mergeCurrentIdx.value = 0
    mergeKeep.value = 0
    mergeFields.value = new Set()
    showMergeDialog.value = true
  }

  function toggleMergeField(key: string) {
    const s = new Set(mergeFields.value)
    if (s.has(key)) s.delete(key)
    else s.add(key)
    mergeFields.value = s
  }

  async function confirmMerge() {
    const group = mergeCurrentGroup.value
    const primary = { ...group[mergeKeep.value] }
    const others = group.filter((_, i) => i !== mergeKeep.value)

    for (const other of others) {
      if (mergeFields.value.has(`emails-${other.id}`))
        primary.emails = [...primary.emails, ...other.emails]
      if (mergeFields.value.has(`phones-${other.id}`))
        primary.phones = [...primary.phones, ...other.phones]
      if (mergeFields.value.has(`addresses-${other.id}`))
        primary.addresses = [...primary.addresses, ...other.addresses]
      if (mergeFields.value.has(`organization-${other.id}`))
        primary.organization = other.organization
      if (mergeFields.value.has(`title-${other.id}`)) primary.title = other.title
      if (mergeFields.value.has(`birthday-${other.id}`)) primary.birthday = other.birthday
      if (mergeFields.value.has(`photo-${other.id}`)) primary.photo = other.photo
      if (mergeFields.value.has(`notes-${other.id}`)) primary.notes = other.notes
      if (mergeFields.value.has(`categories-${other.id}`)) primary.categories = other.categories

      await deleteContact(other)
    }

    await updateContact(primary)

    if (mergeCurrentIdx.value < mergeGroups.value.length - 1) {
      mergeCurrentIdx.value++
      mergeKeep.value = 0
      mergeFields.value = new Set()
    } else {
      showMergeDialog.value = false
      if (selectedAddressBookUrl.value) await fetchContacts(selectedAddressBookUrl.value)
      showMessage({ title: $gettext('Duplicates merged') })
    }
  }

  function skipMerge() {
    if (mergeCurrentIdx.value < mergeGroups.value.length - 1) {
      mergeCurrentIdx.value++
      mergeKeep.value = 0
      mergeFields.value = new Set()
    } else {
      showMergeDialog.value = false
    }
  }

  return {
    addressBooks,
    selectedAddressBookUrl,
    halfElement,
    onAddressBookChange,
    contactsFileInput,
    importContacts,
    exportContacts,
    mergeDuplicates,
    showImportDialog,
    importItems,
    importTargets,
    importInitialTargetUrl,
    importSuggestedName,
    onImported,
    showMergeDialog,
    closeMergeDialog,
    mergePanelRef,
    mergeCurrentIdx,
    mergeGroups,
    mergeCurrentGroup,
    mergeKeep,
    mergeAvailableFields,
    mergeFields,
    toggleMergeField,
    skipMerge,
    confirmMerge
  }
}
