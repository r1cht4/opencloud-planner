<!--
  ContactsCsvCard – the "contacts CSV" block of Settings → Data → Import & export.

  Self-contained: no props, two events.
    props:  none
    emits:  `changed` — contacts were imported (host may refresh its lists)

  Renders an address-book selector (source for the export), an **Import CSV**
  button (opens `CsvDialog` in import mode with the chosen file's text) and an
  **Export CSV** button (opens `CsvDialog` in export mode with the contacts of
  the selected address book). It loads address books and contacts itself.
-->
<template>
  <div class="settings-block contacts-csv-card">
    <p class="settings-block-title">{{ $gettext('Contacts CSV') }}</p>

    <div class="settings-button-row">
      <select
        v-if="addressBooks.length > 1"
        v-model="selectedUrl"
        class="settings-select settings-select--fill"
        :aria-label="$gettext('Address book')"
        @change="onAddressBookChange"
      >
        <option v-for="book in addressBooks" :key="book.url" :value="book.url">
          {{ book.displayName }}
        </option>
      </select>

      <oc-button appearance="outline" :disabled="busy" @click="fileInput?.click()">
        <oc-icon name="download" size="small" />
        <span>{{ $gettext('Import CSV') }}</span>
      </oc-button>

      <input
        ref="fileInput"
        type="file"
        accept=".csv,text/csv"
        class="file-input-hidden"
        :aria-label="$gettext('CSV file')"
        @change="onFileChosen"
      />

      <oc-button
        appearance="outline"
        :disabled="busy || !contacts.length"
        @click="dialogMode = 'export'"
      >
        <oc-icon name="upload" size="small" />
        <span>{{ $gettext('Export CSV') }}</span>
      </oc-button>
    </div>

    <p v-if="!addressBooks.length" class="settings-block-hint">
      {{ $gettext('No address book found.') }}
    </p>
    <p v-else-if="!contacts.length && !busy" class="settings-block-hint">
      {{ $gettext('No contacts to export in this address book.') }}
    </p>

    <CsvDialog
      v-if="dialogMode"
      :mode="dialogMode"
      :text="csvText"
      :file-name="csvFileName"
      :contacts="contacts"
      :address-book-name="selectedAddressBookName"
      @close="dialogMode = null"
      @imported="onImported"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useGettext } from 'vue3-gettext'
import { useMessages } from '@opencloud-eu/web-pkg'
import { useContactsService } from '../../composables/useContactsService'
import { isOversizedImportFile, oversizedImportMessage } from '../../composables/importFileLimits'
import CsvDialog from './CsvDialog.vue'
import '../../styles/settings.css'

defineOptions({ name: 'ContactsCsvCard' })

const emit = defineEmits<{ changed: [] }>()

const { $gettext } = useGettext()
const { showErrorMessage } = useMessages()
const { addressBooks, contacts, fetchAddressBooks, fetchContacts } = useContactsService()

const fileInput = ref<HTMLInputElement | null>(null)
const selectedUrl = ref('')
const csvText = ref('')
const csvFileName = ref('contacts.csv')
const dialogMode = ref<'import' | 'export' | null>(null)
const busy = ref(false)

const selectedAddressBookName = computed(
  () => addressBooks.value.find((book) => book.url === selectedUrl.value)?.displayName ?? 'contacts'
)

async function load() {
  busy.value = true
  try {
    await fetchAddressBooks()
    if (!selectedUrl.value || !addressBooks.value.some((book) => book.url === selectedUrl.value)) {
      selectedUrl.value = addressBooks.value[0]?.url ?? ''
    }
    if (selectedUrl.value) await fetchContacts(selectedUrl.value)
  } finally {
    busy.value = false
  }
}

onMounted(load)

async function onAddressBookChange() {
  await load()
}

async function onFileChosen(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  // Refuse huge files instead of parsing them on the main thread.
  if (isOversizedImportFile(file)) {
    showErrorMessage({ title: oversizedImportMessage($gettext) })
    return
  }

  csvText.value = await file.text()
  csvFileName.value = file.name || 'contacts.csv'
  dialogMode.value = 'import'
}

async function onImported() {
  dialogMode.value = null
  await load()
  emit('changed')
}
</script>

<style scoped>
.file-input-hidden {
  display: none;
}
</style>
