<!--
  CsvDialog – contacts CSV import (with column mapping) and export.

  Self-contained dialog (own overlay, `role="dialog"`, focus trap via
  `useModalA11y`), opened by `ContactsCsvCard.vue`.

    props:
      mode: 'import' | 'export'
      text?: string              import only — raw CSV text of the chosen file
      fileName?: string         import only — file name (import + messages)
      contacts?: Contact[]      export only — contacts to write
      addressBookName?: string  export only — used for the download file name

    emits:
      close              the dialog should be removed by the host
      imported {created, exists, failed}   import finished (counts for the host)

  Import: sniffs Google/Outlook headers (`detectFormat`), falls back to a
  column → field mapping UI for unknown formats, shows a preview and imports
  through the shared lossless path (`buildVcard` + `useImport`, `If-None-Match`).
  Export: Google-compatible CSV of the passed contacts.
-->
<template>
  <Teleport to="body">
    <div class="modal-overlay" @click.self="close">
      <div
        ref="panelRef"
        class="modal-panel csv-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="contacts-csv-title"
      >
        <h2 id="contacts-csv-title" class="modal-title">
          {{
            mode === 'import'
              ? $gettext('Import contacts from CSV')
              : $gettext('Export contacts as CSV')
          }}
        </h2>

        <!-- ── Import ─────────────────────────────────────────────────────── -->
        <template v-if="mode === 'import'">
          <p class="card-hint">
            {{
              $ngettext(
                '%{count} contact in this file',
                '%{count} contacts in this file',
                parsed?.contacts.length ?? 0,
                { count: parsed?.contacts.length ?? 0 }
              )
            }}
          </p>

          <p class="card-hint">
            {{ $gettext('Detected format') }}: <strong>{{ formatLabel }}</strong>
          </p>

          <ul v-if="showMapping" class="mapping-list">
            <li v-for="(_column, index) in mapping" :key="index" class="mapping-row">
              <span class="mapping-column">{{ headerLabel(index) }}</span>
              <select
                :value="mapping[index]"
                class="form-select"
                :aria-label="`${$gettext('Column')}: ${headerLabel(index)}`"
                @change="onMappingChange(index, ($event.target as HTMLSelectElement).value)"
              >
                <option v-for="field in CONTACT_CSV_FIELDS" :key="field" :value="field">
                  {{ fieldLabel(field) }}
                </option>
              </select>
            </li>
          </ul>

          <ul v-if="previewContacts.length" class="preview-list">
            <li v-for="contact in previewContacts" :key="contact.id" class="preview-row">
              <span class="preview-name">{{ contact.displayName }}</span>
              <span class="preview-detail">{{ contactDetails(contact) }}</span>
            </li>
          </ul>

          <div class="target-group">
            <select
              v-model="targetMode"
              class="form-select"
              :aria-label="$gettext('Import target')"
            >
              <option value="existing" :disabled="!targets.length">
                {{ $gettext('Into an existing address book') }}
              </option>
              <option value="new">{{ $gettext('Into a new address book') }}</option>
            </select>
            <select
              v-if="targetMode === 'existing'"
              v-model="targetUrl"
              class="form-select"
              :aria-label="$gettext('Address book')"
            >
              <option v-for="target in targets" :key="target.url" :value="target.url">
                {{ target.displayName }}
              </option>
            </select>
            <input
              v-else
              v-model="newName"
              type="text"
              class="form-input"
              :placeholder="$gettext('Name')"
              :aria-label="$gettext('Name of the new address book')"
            />
          </div>

          <div class="modal-actions">
            <div class="spacer" />
            <oc-button appearance="outline" :disabled="busy" @click="close">
              {{ $gettext('Cancel') }}
            </oc-button>
            <oc-button appearance="filled" :disabled="busy || !canImport" @click="submitImport">
              {{ busy ? $gettext('Importing…') : $gettext('Import') }}
            </oc-button>
          </div>
        </template>

        <!-- ── Export ─────────────────────────────────────────────────────── -->
        <template v-else>
          <p class="card-hint">
            {{
              $ngettext(
                '%{count} contact will be exported',
                '%{count} contacts will be exported',
                props.contacts.length,
                { count: props.contacts.length }
              )
            }}
          </p>
          <p class="card-hint">
            {{
              $gettext(
                'The CSV contains name, email addresses, phone numbers, birthday, organization and notes. Use the .vcf export for a complete copy.'
              )
            }}
          </p>

          <pre class="csv-preview" aria-hidden="true">{{ exportPreview }}</pre>

          <div class="modal-actions">
            <div class="spacer" />
            <oc-button appearance="outline" @click="close">{{ $gettext('Cancel') }}</oc-button>
            <oc-button appearance="filled" :disabled="!props.contacts.length" @click="submitExport">
              {{ $gettext('Export') }}
            </oc-button>
          </div>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useGettext } from 'vue3-gettext'
import { useModalA11y } from '../../composables/useModalA11y'
import { buildVcard } from '../../composables/useContactsService'
import { useImport, type ImportTarget } from '../../composables/useImport'
import { collectionSlug } from '../../composables/importExport'
import { downloadBlob } from '../../composables/download'
import {
  CONTACT_CSV_FIELDS,
  contactsToGoogleCsv,
  parseContactsCsv,
  type ContactCsvField,
  type CsvMapping,
  type ParsedContactsCsv
} from '../../tools/contactsCsv'
import type { Contact } from '../../types'
import '../../styles/modal.css'

defineOptions({ name: 'CsvDialog' })

const props = withDefaults(
  defineProps<{
    mode: 'import' | 'export'
    text?: string
    fileName?: string
    contacts?: Contact[]
    addressBookName?: string
  }>(),
  {
    text: '',
    fileName: 'contacts.csv',
    contacts: () => [],
    addressBookName: 'contacts'
  }
)

const emit = defineEmits<{
  close: []
  imported: [result: { created: number; exists: number; failed: number }]
}>()

const { $gettext, $ngettext } = useGettext()
const { prepareImport, loadTargets, runImport, reportImport, importBusy } = useImport()

const panelRef = ref<HTMLElement | null>(null)
const busy = computed(() => importBusy.value)
// The host opens the dialog with `v-if`, so the panel starts open; flipping this
// once on mount is what makes `useModalA11y` move focus in and trap Tab/Escape.
const isOpen = ref(false)
useModalA11y(panelRef, isOpen, { onClose: close })

/* ── Import state ───────────────────────────────────────────────────────── */

const parsed = ref<ParsedContactsCsv | null>(null)
const mapping = ref<CsvMapping>([])
const targets = ref<ImportTarget[]>([])
const targetMode = ref<'existing' | 'new'>('existing')
const targetUrl = ref('')
const newName = ref('')

const formatLabel = computed(() => {
  switch (parsed.value?.format) {
    case 'google':
      return $gettext('Google Contacts')
    case 'outlook':
      return $gettext('Outlook')
    default:
      return $gettext('Unknown')
  }
})

/** Unknown headers (and empty mappings) get the column → field UI. */
const showMapping = computed(
  () =>
    !!parsed.value && (parsed.value.format === 'unknown' || parsed.value.mapping.every(isIgnored))
)

function isIgnored(field: ContactCsvField): boolean {
  return field === 'ignore'
}

const previewContacts = computed(() => (parsed.value?.contacts ?? []).slice(0, 5))

const canImport = computed(
  () =>
    !!parsed.value?.contacts.length &&
    (targetMode.value === 'new' ? !!newName.value.trim() : !!targetUrl.value)
)

function headerLabel(index: number): string {
  const cell = parsed.value?.header[index]?.trim()
  return cell || $gettext('Column %{index}', { index: index + 1 })
}

function fieldLabel(field: ContactCsvField): string {
  switch (field) {
    case 'ignore':
      return $gettext('Do not import')
    case 'displayName':
      return $gettext('Full name')
    case 'firstName':
      return $gettext('First name')
    case 'lastName':
      return $gettext('Last name')
    case 'organization':
      return $gettext('Organization')
    case 'title':
      return $gettext('Job title')
    case 'birthday':
      return $gettext('Birthday')
    case 'notes':
      return $gettext('Notes')
    case 'email':
      return $gettext('Email')
    case 'phone':
      return $gettext('Phone')
    default: {
      const index = Number(field.replace(/[^0-9]/g, ''))
      return field.startsWith('email')
        ? `${$gettext('Email')} ${index}`
        : `${$gettext('Phone')} ${index}`
    }
  }
}

function contactDetails(contact: Contact): string {
  return [contact.emails[0]?.value, contact.phones[0]?.value, contact.birthday]
    .filter(Boolean)
    .join(' · ')
}

function onMappingChange(index: number, field: string) {
  const next = mapping.value.slice()
  next[index] = field as ContactCsvField
  mapping.value = next
  if (props.mode === 'import' && props.text) {
    parsed.value = parseContactsCsv(props.text, next)
  }
}

/* ── Export state ───────────────────────────────────────────────────────── */

const exportCsv = computed(() =>
  props.mode === 'export' ? contactsToGoogleCsv(props.contacts) : ''
)

const exportPreview = computed(() => exportCsv.value.split('\r\n').slice(0, 6).join('\n'))

/* ── Lifecycle ──────────────────────────────────────────────────────────── */

onMounted(async () => {
  isOpen.value = true
  if (props.mode !== 'import') return

  const initial = parseContactsCsv(props.text)
  parsed.value = initial
  mapping.value = initial.mapping.slice()
  newName.value = props.fileName.replace(/\.[^.]+$/, '') || $gettext('Contacts')

  targets.value = await loadTargets('contacts')
  targetUrl.value = targets.value[0]?.url ?? ''
  if (!targets.value.length) targetMode.value = 'new'
})

/* ── Actions ────────────────────────────────────────────────────────────── */

function close() {
  if (busy.value) return
  emit('close')
}

async function submitImport() {
  if (!canImport.value || !parsed.value) return

  const vcards = parsed.value.contacts.map((contact) => buildVcard(contact)).join('\r\n')
  const prepared = await prepareImport('contacts', vcards, props.fileName)
  if (!prepared) return

  const selection =
    targetMode.value === 'existing'
      ? { mode: 'existing' as const, targetUrl: targetUrl.value }
      : { mode: 'new' as const, newName: newName.value.trim() }

  const counts = await runImport(prepared, selection)
  if (!counts) return

  reportImport(counts)
  emit('imported', { created: counts.created, exists: counts.exists, failed: counts.failed })
  emit('close')
}

function submitExport() {
  const blob = new Blob([exportCsv.value], { type: 'text/csv;charset=utf-8' })
  downloadBlob(blob, `${collectionSlug(props.addressBookName || 'contacts')}.csv`)
  emit('close')
}
</script>

<style scoped>
.csv-panel {
  width: 560px;
}

.card-hint {
  margin: 0 0 8px;
  font-size: 0.8125rem;
  color: var(--oc-role-on-surface-variant, #40484c);
}

.form-select {
  width: auto;
  min-width: 160px;
  max-width: 260px;
  border: 1px solid var(--oc-role-outline-variant, #bfc8cc);
  border-radius: 4px;
  padding: 8px 12px;
  font-size: 0.875rem;
  background: var(--oc-role-surface, #fbfcfe);
  color: var(--oc-role-on-surface, #191c1d);
}

.mapping-list,
.preview-list {
  list-style: none;
  margin: 8px 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 220px;
  overflow-y: auto;
}

.mapping-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.mapping-column {
  font-size: 0.8125rem;
  color: var(--oc-role-on-surface, #191c1d);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-row {
  display: flex;
  flex-direction: column;
  padding: 4px 0;
  border-bottom: 1px solid var(--oc-role-outline-variant, #bfc8cc);
}
.preview-row:last-child {
  border-bottom: none;
}

.preview-name {
  font-size: 0.875rem;
  color: var(--oc-role-on-surface, #191c1d);
}

.preview-detail {
  font-size: 0.75rem;
  color: var(--oc-role-on-surface-variant, #40484c);
}

.target-group {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}

.csv-preview {
  margin: 8px 0;
  padding: 8px 12px;
  max-height: 200px;
  overflow: auto;
  font-size: 0.75rem;
  border-radius: 8px;
  background: var(--oc-role-surface-container, #eef1f3);
  color: var(--oc-role-on-surface-variant, #40484c);
  white-space: pre;
}

.modal-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--oc-role-outline-variant, #bfc8cc);
}

.spacer {
  flex: 1;
}
</style>
