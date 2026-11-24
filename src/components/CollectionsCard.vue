<template>
  <div class="collections-card">
    <!-- ── Calendars ─────────────────────────────────────────────────────── -->
    <div class="collection-group">
      <div class="group-head">
        <h3 class="group-title">{{ $gettext('Calendars') }}</h3>
        <oc-button appearance="outline" size="small" @click="openCreate('calendar')">
          <oc-icon name="add" size="small" />
          <span>{{ $gettext('New calendar') }}</span>
        </oc-button>
      </div>

      <p v-if="!calendars.length" class="card-hint">{{ $gettext('No calendars found.') }}</p>

      <ul v-else class="collection-list">
        <li v-for="cal in calendars" :key="cal.url" class="collection-row">
          <span class="swatch" :style="{ backgroundColor: hex6(cal.color) }" aria-hidden="true" />
          <span class="collection-name" :title="cal.displayName">{{ cal.displayName }}</span>
          <span v-if="isBirthdayCalendar(cal.url)" class="badge">
            {{ $gettext('Birthday calendar') }}
          </span>
          <span class="row-actions">
            <input
              type="color"
              class="color-input"
              :value="hex6(cal.color)"
              :aria-label="`${$gettext('Color')}: ${cal.displayName}`"
              :title="$gettext('Color')"
              @change="onColorChange(cal, $event)"
            />
            <oc-button
              appearance="raw"
              size="small"
              :aria-label="`${$gettext('Rename')} ${cal.displayName}`"
              :title="$gettext('Rename')"
              @click="openRename('calendar', cal)"
            >
              <oc-icon name="pencil" size="small" />
            </oc-button>
            <oc-button
              appearance="raw"
              size="small"
              :disabled="lastCalendar"
              :aria-label="`${$gettext('Delete')} ${cal.displayName}`"
              :aria-description="lastCalendar ? $gettext('At least one calendar must remain.') : ''"
              :title="
                lastCalendar ? $gettext('At least one calendar must remain.') : $gettext('Delete')
              "
              @click="confirmDelete('calendar', cal)"
            >
              <oc-icon name="delete-bin" size="small" />
            </oc-button>
          </span>
        </li>
      </ul>

      <p v-if="lastCalendar" class="card-hint">
        {{ $gettext('At least one calendar must remain.') }}
      </p>
    </div>

    <!-- ── Address books ─────────────────────────────────────────────────── -->
    <div class="collection-group">
      <div class="group-head">
        <h3 class="group-title">{{ $gettext('Address books') }}</h3>
        <oc-button appearance="outline" size="small" @click="openCreate('addressbook')">
          <oc-icon name="add" size="small" />
          <span>{{ $gettext('New address book') }}</span>
        </oc-button>
      </div>

      <p v-if="!addressBooks.length" class="card-hint">{{ $gettext('No address books found.') }}</p>

      <ul v-else class="collection-list">
        <li v-for="book in addressBooks" :key="book.url" class="collection-row">
          <span class="swatch" :style="{ backgroundColor: addressBookSwatch }" aria-hidden="true" />
          <span class="collection-name" :title="book.displayName">{{ book.displayName }}</span>
          <span class="row-actions">
            <oc-button
              appearance="raw"
              size="small"
              :aria-label="`${$gettext('Rename')} ${book.displayName}`"
              :title="$gettext('Rename')"
              @click="openRename('addressbook', book)"
            >
              <oc-icon name="pencil" size="small" />
            </oc-button>
            <oc-button
              appearance="raw"
              size="small"
              :disabled="lastAddressBook"
              :aria-label="`${$gettext('Delete')} ${book.displayName}`"
              :aria-description="
                lastAddressBook ? $gettext('At least one address book must remain.') : ''
              "
              :title="
                lastAddressBook
                  ? $gettext('At least one address book must remain.')
                  : $gettext('Delete')
              "
              @click="confirmDelete('addressbook', book)"
            >
              <oc-icon name="delete-bin" size="small" />
            </oc-button>
          </span>
        </li>
      </ul>

      <p v-if="lastAddressBook" class="card-hint">
        {{ $gettext('At least one address book must remain.') }}
      </p>
    </div>

    <!-- ── Create / rename dialog ────────────────────────────────────────── -->
    <Teleport to="body">
      <div v-if="dialogMode" class="modal-overlay" @click.self="closeDialog">
        <div
          ref="dialogPanelRef"
          class="modal-panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="collection-dialog-title"
        >
          <h2 id="collection-dialog-title" class="modal-title">{{ dialogTitle }}</h2>

          <label class="form-field">
            <span class="form-label">{{ $gettext('Name') }}</span>
            <input
              v-model="formName"
              type="text"
              class="form-input"
              :aria-label="$gettext('Name')"
              @keydown.enter.prevent="submitDialog"
            />
          </label>

          <label v-if="dialogMode === 'create-calendar'" class="form-field">
            <span class="form-label">{{ $gettext('Color') }}</span>
            <input
              v-model="formColor"
              type="color"
              class="form-input color-input"
              :aria-label="$gettext('Color')"
            />
          </label>

          <p v-if="busy" class="card-hint" role="status">{{ $gettext('Saving…') }}</p>

          <div class="modal-actions">
            <div class="spacer" />
            <oc-button appearance="outline" :disabled="busy" @click="closeDialog">
              {{ $gettext('Cancel') }}
            </oc-button>
            <oc-button
              appearance="filled"
              :disabled="busy || !formName.trim()"
              @click="submitDialog"
            >
              {{ dialogMode === 'rename' ? $gettext('Save') : $gettext('Add') }}
            </oc-button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useGettext } from 'vue3-gettext'
import { useMessages, useModals } from '@opencloud-eu/web-pkg'
import { useCalendarService } from '../composables/useCalendarService'
import { DEFAULT_CALENDAR_COLOR } from '../composables/colorUtils'
import { useContactsService } from '../composables/useContactsService'
import { useDAVClient } from '../composables/useDAVClient'
import {
  createAddressBook,
  createCalendar,
  deleteCollection,
  normalizeHexColor,
  renameCollection,
  setCollectionColor
} from '../composables/useCollections'
import { isBirthdaySyncEnabled, setBirthdaySyncEnabled } from '../composables/useBirthdaySync'
import { useModalA11y } from '../composables/useModalA11y'
import type { AddressBook, CalendarCollection } from '../types'

defineOptions({ name: 'CollectionsCard' })

const emit = defineEmits<{ changed: [] }>()

const { $gettext } = useGettext()
const { showMessage, showErrorMessage } = useMessages()
const { dispatchModal } = useModals()
const { getState } = useDAVClient()
const { calendars, fetchCalendars } = useCalendarService()
const { addressBooks, fetchAddressBooks } = useContactsService()

const addressBookSwatch = 'var(--oc-role-outline, #6F797D)'

type DialogMode = 'create-calendar' | 'create-addressbook' | 'rename'
type CollectionKind = 'calendar' | 'addressbook'

const dialogPanelRef = ref<HTMLElement | null>(null)
const dialogMode = ref<DialogMode | null>(null)
const formName = ref('')
const formColor = ref(DEFAULT_CALENDAR_COLOR)
const busy = ref(false)
const renameTarget = ref<{ kind: CollectionKind; url: string } | null>(null)

const isDialogOpen = computed(() => dialogMode.value !== null)

const dialogTitle = computed(() => {
  switch (dialogMode.value) {
    case 'create-calendar':
      return $gettext('New calendar')
    case 'create-addressbook':
      return $gettext('New address book')
    case 'rename':
      return renameTarget.value?.kind === 'addressbook'
        ? $gettext('Rename address book')
        : $gettext('Rename calendar')
    default:
      return ''
  }
})

const lastCalendar = computed(() => calendars.value.length <= 1)
const lastAddressBook = computed(() => addressBooks.value.length <= 1)

function hex6(color: string): string {
  return normalizeHexColor(color) || DEFAULT_CALENDAR_COLOR
}

/**
 * The birthday calendar is materialised by the birthday sync under
 * `<principal>/birthdays/`; deleting it must also switch the toggle off,
 * otherwise the next auto-sync silently recreates it.
 */
function isBirthdayCalendar(url: string): boolean {
  const principal = getState('calendar')?.principalUrl
  const normalized = url.replace(/\/+$/, '')
  if (principal && normalized === `${principal.replace(/\/+$/, '')}/birthdays`) return true
  return /\/birthdays$/i.test(normalized)
}

async function refresh() {
  await fetchCalendars()
  await fetchAddressBooks()
  emit('changed')
}

onMounted(refresh)

useModalA11y(dialogPanelRef, isDialogOpen, { onClose: closeDialog })

function openCreate(kind: CollectionKind) {
  renameTarget.value = null
  dialogMode.value = kind === 'calendar' ? 'create-calendar' : 'create-addressbook'
  formName.value = ''
  formColor.value = DEFAULT_CALENDAR_COLOR
}

function openRename(kind: CollectionKind, collection: CalendarCollection | AddressBook) {
  renameTarget.value = { kind, url: collection.url }
  dialogMode.value = 'rename'
  formName.value = collection.displayName
}

function closeDialog() {
  if (busy.value) return
  dialogMode.value = null
  renameTarget.value = null
}

async function submitDialog() {
  if (busy.value) return
  const name = formName.value.trim()
  if (!name) return
  busy.value = true
  try {
    if (dialogMode.value === 'rename' && renameTarget.value) {
      const { kind, url } = renameTarget.value
      await renameCollection(url, name)
      showMessage({
        title: kind === 'calendar' ? $gettext('Calendar renamed') : $gettext('Address book renamed')
      })
    } else if (dialogMode.value === 'create-calendar') {
      await createCalendar(name, formColor.value)
      showMessage({ title: $gettext('Calendar created') })
    } else if (dialogMode.value === 'create-addressbook') {
      await createAddressBook(name)
      showMessage({ title: $gettext('Address book created') })
    }
    dialogMode.value = null
    renameTarget.value = null
    await refresh()
  } catch (err) {
    console.warn('[planner] collection dialog failed:', err)
    if (dialogMode.value === 'rename') {
      showErrorMessage({
        title:
          renameTarget.value?.kind === 'addressbook'
            ? $gettext('Could not rename address book')
            : $gettext('Could not rename calendar')
      })
    } else if (dialogMode.value === 'create-addressbook') {
      showErrorMessage({ title: $gettext('Could not create address book') })
    } else {
      showErrorMessage({ title: $gettext('Could not create calendar') })
    }
  } finally {
    busy.value = false
  }
}

async function onColorChange(cal: CalendarCollection, e: Event) {
  const input = e.target as HTMLInputElement
  const color = normalizeHexColor(input.value)
  if (!color) return
  try {
    await setCollectionColor(cal.url, color)
    showMessage({ title: $gettext('Calendar color updated') })
    await refresh()
  } catch (err) {
    console.warn('[planner] set collection color failed:', err)
    // Restore the previous swatch so the UI does not lie about the server state.
    input.value = hex6(cal.color)
    showErrorMessage({ title: $gettext('Could not change calendar color') })
  }
}

function confirmDelete(kind: CollectionKind, collection: CalendarCollection | AddressBook) {
  const name = collection.displayName
  const birthday = kind === 'calendar' && isBirthdayCalendar(collection.url)
  dispatchModal({
    title: kind === 'calendar' ? $gettext('Delete calendar') : $gettext('Delete address book'),
    message:
      kind === 'calendar'
        ? $gettext(
            'Do you want to delete the calendar "%{name}"? All events in it will be deleted permanently.',
            { name }
          )
        : $gettext(
            'Do you want to delete the address book "%{name}"? All contacts in it will be deleted permanently.',
            { name }
          ),
    confirmText: $gettext('Delete'),
    async onConfirm() {
      try {
        await deleteCollection(collection.url)
      } catch (err) {
        console.warn('[planner] delete collection failed:', err)
        showErrorMessage({
          title:
            kind === 'calendar'
              ? $gettext('Could not delete calendar')
              : $gettext('Could not delete address book')
        })
        await refresh()
        return
      }

      if (birthday && isBirthdaySyncEnabled()) {
        // The toggle only stops auto-sync; deleting the calendar it manages
        // would otherwise be undone by the next reconcile.
        setBirthdaySyncEnabled(false)
        showMessage({ title: $gettext('Birthday sync turned off') })
      }

      showMessage({
        title: kind === 'calendar' ? $gettext('Calendar deleted') : $gettext('Address book deleted')
      })
      await refresh()
    }
  })
}
</script>

<style scoped>
.collections-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.card-hint {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--oc-role-on-surface-variant, #40484c);
}

/* The groups sit inside the group card of Settings → Data → Calendars & address
   books, so only the second one needs a divider. */
.collection-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--oc-role-outline-variant, #bfc8cc);
}

.collection-group:first-of-type {
  padding-top: 0;
  border-top: 0;
}

.group-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.group-title {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--oc-role-on-surface, #191c1d);
}

.collection-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.collection-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
  border-bottom: 1px solid var(--oc-role-outline-variant, #bfc8cc);
}
.collection-row:last-child {
  border-bottom: none;
}

.swatch {
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  border-radius: 4px;
  border: 1px solid var(--oc-role-outline-variant, #bfc8cc);
}

.collection-name {
  flex: 1;
  min-width: 0;
  font-size: 0.875rem;
  color: var(--oc-role-on-surface, #191c1d);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.badge {
  font-size: 0.6875rem;
  padding: 2px 6px;
  border-radius: 999px;
  background: var(--oc-role-secondary-container, #e6ebed);
  color: var(--oc-role-on-surface-variant, #40484c);
  white-space: nowrap;
}

.row-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.color-input {
  width: 32px;
  height: 28px;
  padding: 2px;
  border: 1px solid var(--oc-role-outline-variant, #bfc8cc);
  border-radius: 4px;
  background: var(--oc-role-surface, #fbfcfe);
  cursor: pointer;
}

/* Modal overlay + panel (same pattern as the other Tools dialogs) */
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(4px);
}

.modal-panel {
  background: var(--oc-role-surface-container-lowest, #ffffff);
  color: var(--oc-role-on-surface, #191c1d);
  border-radius: 16px;
  padding: 12px 24px 24px;
  width: 460px;
  max-width: 90vw;
  max-height: 85vh;
  overflow-y: auto;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
}

.modal-title {
  font-size: 1.125rem;
  font-weight: 600;
  margin-bottom: 14px;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 12px;
}

.form-label {
  font-size: 0.8125rem;
  color: var(--oc-role-on-surface-variant, #40484c);
}

.form-input {
  border: 1px solid var(--oc-role-outline-variant, #bfc8cc);
  border-radius: 4px;
  padding: 8px 12px;
  font-size: 0.875rem;
  background: var(--oc-role-surface, #fbfcfe);
  color: var(--oc-role-on-surface, #191c1d);
  box-sizing: border-box;
}
.form-input:focus {
  outline: none;
  border-color: var(--oc-role-secondary, #20434f);
}

.form-field .color-input {
  width: 64px;
}

.modal-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 24px;
  margin: 12px -24px -24px;
  border-top: 1px solid var(--oc-role-outline-variant, #bfc8cc);
  background: var(--oc-role-surface-container-lowest, #ffffff);
  position: sticky;
  bottom: -24px;
  border-radius: 0 0 16px 16px;
}
.spacer {
  flex: 1;
}

@media (max-width: 640px) {
  .group-head {
    flex-direction: column;
    align-items: stretch;
  }

  .modal-panel {
    width: 100%;
    max-width: 100%;
    height: 100%;
    max-height: 100%;
    border-radius: 0;
  }
}
</style>
