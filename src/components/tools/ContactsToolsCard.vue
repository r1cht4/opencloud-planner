<template>
  <!-- Import & export: one block of the group, no card chrome of its own. -->
  <div v-if="part === 'import'" class="settings-block contacts-tools-card">
    <p class="settings-block-title">{{ $gettext('Contacts (.vcf)') }}</p>

    <div class="settings-button-row">
      <select
        v-if="addressBooks.length > 1"
        v-model="selectedAddressBookUrl"
        class="settings-select settings-select--fill"
        :aria-label="$gettext('Address book')"
        @change="onAddressBookChange"
      >
        <option v-for="book in addressBooks" :key="book.url" :value="book.url">
          {{ book.displayName }}
        </option>
      </select>

      <!-- Import .vcf — oc-button triggers a hidden file input -->
      <oc-button appearance="outline" @click="contactsFileInput?.click()">
        <oc-icon name="download" size="small" />
        <span>{{ $gettext('Import .vcf') }}</span>
      </oc-button>
      <input
        ref="contactsFileInput"
        type="file"
        accept=".vcf,text/vcard"
        class="file-input-hidden"
        @change="importContacts"
      />

      <!-- Export .vcf -->
      <oc-button appearance="outline" @click="exportContacts">
        <oc-icon name="upload" size="small" />
        <span>{{ $gettext('Export .vcf') }}</span>
      </oc-button>
    </div>

    <!-- Import target dialog (shared with the Files app actions) -->
    <ImportDialog
      v-if="showImportDialog"
      kind="contacts"
      :items="importItems"
      :targets="importTargets"
      :initial-target-url="importInitialTargetUrl"
      :suggested-name="importSuggestedName"
      @close="showImportDialog = false"
      @imported="onImported"
    />
  </div>

  <!-- Clean up: merge duplicate contacts (the birthday sync lives in Contacts). -->
  <div v-else ref="halfElement" class="settings-block contacts-cleanup">
    <p class="settings-block-title">{{ $gettext('Duplicate contacts') }}</p>
    <div class="settings-button-row">
      <select
        v-if="addressBooks.length > 1"
        v-model="selectedAddressBookUrl"
        class="settings-select settings-select--grow"
        :aria-label="$gettext('Address book')"
        @change="onAddressBookChange"
      >
        <option v-for="book in addressBooks" :key="book.url" :value="book.url">
          {{ book.displayName }}
        </option>
      </select>

      <oc-button appearance="outline" @click="mergeDuplicates">
        <oc-icon name="group" size="small" />
        <span>{{ $gettext('Merge duplicates') }}</span>
      </oc-button>
    </div>

    <!-- Merge duplicates dialog -->
    <Teleport to="body">
      <div v-if="showMergeDialog" class="modal-overlay" @click.self="closeMergeDialog">
        <div
          ref="mergePanelRef"
          class="modal-panel merge-panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="merge-dialog-title"
        >
          <h2 id="merge-dialog-title" class="modal-title">
            {{ $gettext('Merge duplicates') }} ({{ mergeCurrentIdx + 1 }}/{{ mergeGroups.length }})
          </h2>

          <p class="merge-hint">{{ $gettext('Select the contact to keep:') }}</p>

          <div
            class="merge-cards"
            role="radiogroup"
            :aria-label="$gettext('Choose which contact to keep')"
          >
            <button
              v-for="(c, idx) in mergeCurrentGroup"
              :key="c.id"
              class="merge-card"
              :class="{ 'merge-card--selected': mergeKeep === idx }"
              role="radio"
              :aria-checked="mergeKeep === idx"
              :tabindex="mergeKeep === idx ? 0 : -1"
              @click="mergeKeep = idx"
              @keydown.enter.prevent="mergeKeep = idx"
              @keydown.space.prevent="mergeKeep = idx"
            >
              <div class="merge-card-name">{{ c.displayName }}</div>
              <div v-if="c.emails.length" class="merge-card-detail">{{ c.emails[0].value }}</div>
              <div v-if="c.phones.length" class="merge-card-detail">{{ c.phones[0].value }}</div>
              <div v-if="c.organization" class="merge-card-detail">{{ c.organization }}</div>
              <div v-if="c.birthday" class="merge-card-detail">{{ c.birthday }}</div>
            </button>
          </div>

          <div v-if="mergeAvailableFields.length > 0" class="merge-fields-section">
            <p class="merge-hint">{{ $gettext('Add fields from duplicate:') }}</p>
            <label v-for="field in mergeAvailableFields" :key="field.key" class="merge-field-row">
              <input
                type="checkbox"
                :checked="mergeFields.has(field.key)"
                class="form-checkbox"
                @change="toggleMergeField(field.key)"
              />
              <span class="merge-field-label">{{ field.label }}:</span>
              <span class="merge-field-value">{{ field.value }}</span>
            </label>
          </div>

          <div class="modal-actions">
            <oc-button appearance="outline" @click="skipMerge">{{ $gettext('Skip') }}</oc-button>
            <div class="spacer" />
            <oc-button appearance="outline" @click="closeMergeDialog">{{
              $gettext('Cancel')
            }}</oc-button>
            <oc-button appearance="filled" @click="confirmMerge">{{ $gettext('Merge') }}</oc-button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
/**
 * Settings → Data: the contacts side of the two groups.
 *
 * `part="import"` renders the `.vcf` block of "Import & export" (import through the
 * shared target dialog, merged export); `part="cleanup"` renders the action of the
 * collapsed "Clean up" group (address-book selector + merge duplicate contacts).
 * Both halves render inside a group card of the Data tab — no card chrome, no
 * repeated heading beyond the block title. The birthday sync is not here: it
 * belongs to Settings → Contacts → Birthdays, next to the switch that enables it.
 *
 * The cleanup instance is lazy: it loads the address books when the "Clean up"
 * section is opened, so rendering the Data tab does not fetch the same collections
 * twice. Both halves report a finished import (`changed`), which makes the Settings
 * page refresh the cards around them.
 */
import { useGettext } from 'vue3-gettext'
import ImportDialog from '../ImportDialog.vue'
import { useContactsTools } from './useContactsTools'
import '../../styles/settings.css'

defineOptions({ name: 'ContactsToolsCard' })

const props = withDefaults(
  defineProps<{
    /** Bumped by the Settings page when the collection manager changed something. */
    refreshKey?: number
    /** Which half of the Data tab to render. */
    part?: 'import' | 'cleanup'
  }>(),
  { refreshKey: 0, part: 'import' }
)

const emit = defineEmits<{ changed: [] }>()

const { $gettext } = useGettext()

const {
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
} = useContactsTools(props, {
  lazy: props.part === 'cleanup',
  onChanged: () => emit('changed')
})
</script>

<style scoped>
.file-input-hidden {
  display: none;
}

.form-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 0.875rem;
  color: var(--oc-role-on-surface, #191c1d);
}

/* Modal overlay/panel/form primitives live in `src/styles/modal.css`; this block
   only raises the stacking order and keeps the sticky action bar. */
.modal-overlay {
  z-index: 9999;
}

.modal-title {
  font-size: 1.125rem;
  margin-bottom: 14px;
}

/* Sticky full-bleed footer (Contacts/Tools dialog pattern). */
.modal-actions {
  padding: 12px 24px;
  margin: 12px -24px -24px;
  background: var(--oc-role-surface-container-lowest, #ffffff);
  position: sticky;
  bottom: -24px;
  border-radius: 0 0 16px 16px;
}

/* Merge panel */
.merge-panel {
  width: 620px;
}
.merge-hint {
  font-size: 0.875rem;
  margin-bottom: 8px;
  color: var(--oc-role-on-surface-variant, #40484c);
}
.merge-cards {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
}
.merge-card {
  flex: 1;
  padding: 12px;
  border: 2px solid var(--oc-role-outline-variant, #bfc8cc);
  border-radius: 12px;
  cursor: pointer;
  background: var(--oc-role-surface, #fbfcfe);
  text-align: left;
  transition: border-color 0.15s;
  color: inherit;
}
.merge-card:hover {
  border-color: var(--oc-role-outline, #6f797d);
}
.merge-card--selected {
  border-color: var(--oc-role-secondary, #20434f);
  background: var(--oc-role-primary-container, #b7eaff);
}
.merge-card-name {
  font-weight: 600;
  font-size: 0.875rem;
  margin-bottom: 4px;
}
.merge-card-detail {
  font-size: 0.75rem;
  color: var(--oc-role-on-surface-variant, #40484c);
}
.merge-fields-section {
  margin-bottom: 12px;
}
.merge-field-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  font-size: 0.8125rem;
  cursor: pointer;
  user-select: none;
}
.merge-field-label {
  font-weight: 500;
  min-width: 80px;
}
.merge-field-value {
  color: var(--oc-role-on-surface-variant, #40484c);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 640px) {
  .merge-panel {
    width: 100%;
    max-width: 100%;
    min-width: 0;
    height: 100%;
    max-height: 100%;
    border-radius: 0;
  }

  .merge-cards {
    flex-direction: column;
  }
}
</style>
