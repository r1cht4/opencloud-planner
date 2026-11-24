<template>
  <main class="contacts-page" :class="{ 'is-contact-detail-open': selectedContact }">
    <ConnectionGate>
      <div class="toolbar">
        <div class="page-title-row">
          <h1 class="page-title">{{ $gettext('Contacts') }}</h1>
          <PageHeaderActions />
        </div>

        <div class="toolbar-actions">
          <oc-select
            v-if="addressBooks.length > 1"
            :model-value="selectedAddressBook"
            :options="addressBooks"
            :label="$gettext('Address book')"
            label-hidden
            option-label="displayName"
            :clearable="false"
            class="addressbook-select"
            @update:model-value="onAddressBookChange"
          />

          <oc-button appearance="filled" color-role="primary" @click="openCreateDialog">
            <oc-icon name="add" size="small" />
            <span>{{ $gettext('New contact') }}</span>
          </oc-button>
        </div>
      </div>

      <div class="search-wrap">
        <oc-text-input
          v-model="searchQuery"
          :label="$gettext('Search contacts')"
          :clear-button-enabled="true"
          :clear-button-accessible-label="$gettext('Clear search')"
        />
      </div>

      <div v-if="!initialized && loading" class="empty-state">
        <oc-spinner size="medium" />
        <span>{{ $gettext('Loading contacts...') }}</span>
      </div>

      <!-- Keep background reloads silent: a failed refresh must not blank a list
         that is already on screen. -->
      <div v-else-if="errorMessage && contacts.length === 0" class="error-banner">
        <oc-icon name="warning" size="small" fill-type="fill" />
        <p class="error-text">{{ errorMessage }}</p>
      </div>

      <div v-else class="split-view" :class="{ 'is-detail-open': selectedContact }">
        <div class="contact-list" role="listbox" :aria-label="$gettext('Contacts')">
          <div v-if="displayContacts.length === 0" class="empty-state-sm">
            {{ $gettext('No contacts found.') }}
          </div>

          <button
            v-for="(contact, idx) in displayContacts"
            :key="contact.id"
            class="contact-row"
            :class="{ 'is-selected': selectedContact?.id === contact.id }"
            role="option"
            :aria-selected="selectedContact?.id === contact.id"
            :tabindex="
              selectedContact?.id === contact.id
                ? 0
                : selectedContact === null && idx === 0
                  ? 0
                  : -1
            "
            @click="selectContact(contact)"
            @keydown.up.prevent="navigateContacts(-1, idx)"
            @keydown.down.prevent="navigateContacts(1, idx)"
            @keydown.enter.prevent="selectContact(contact)"
            @keydown.space.prevent="selectContact(contact)"
          >
            <img
              v-if="safePhotoSrc(contact.photo)"
              :src="safePhotoSrc(contact.photo)"
              class="avatar avatar-photo"
              alt=""
            />
            <div
              v-else
              class="avatar"
              :style="{ backgroundColor: avatarColor(contact.displayName) }"
            >
              {{ initials(contact.displayName) }}
            </div>
            <div class="contact-info">
              <div class="contact-name">{{ contactLabel(contact) }}</div>
              <div v-if="contact.organization" class="contact-sub">{{ contact.organization }}</div>
              <div v-else-if="contact.emails.length" class="contact-sub">
                {{ contact.emails[0].value }}
              </div>
            </div>
          </button>
        </div>

        <div class="contact-detail-pane">
          <button
            v-if="selectedContact"
            type="button"
            class="contact-detail-close"
            :aria-label="$gettext('Close')"
            @click="closeContactDetail"
          >
            <oc-icon name="close" size="small" />
          </button>
          <ContactDetail
            v-if="selectedContact"
            :contact="selectedContact"
            @edit="openEditDialog"
            @delete="onDeleteContact"
          />
          <div v-else class="empty-state">
            <oc-icon name="contacts-book" size="xlarge" />
            <span>{{ $gettext('Select a contact to view details.') }}</span>
          </div>
        </div>
      </div>
    </ConnectionGate>

    <ContactDialog
      :open="showDialog"
      :edit-mode="editMode"
      :contact="editingContact"
      @close="closeDialog"
      @save="onSaveContact"
    />
  </main>
</template>

<script setup lang="ts">
/**
 * ContactsView – page shell for the contacts app.
 *
 * The page is wiring-only: the list/selection/DAV logic lives in
 * `useContactsView`, the contact form dialog in
 * `components/contacts/ContactDialog.vue`. The rendered DOM, classes and e2e
 * selectors are unchanged.
 */
import { onMounted } from 'vue'
import { useGettext } from 'vue3-gettext'
import { safePhotoSrc } from '../composables/useContactsService'
import { useContactsView } from '../composables/useContactsView'
import ConnectionGate from '../components/ConnectionGate.vue'
import ContactDetail from '../components/ContactDetail.vue'
import ContactDialog from '../components/contacts/ContactDialog.vue'
import PageHeaderActions from '../components/PageHeaderActions.vue'
import '../styles/modal.css'

defineOptions({ name: 'ContactsView' })

const { $gettext } = useGettext()

const {
  addressBooks,
  contacts,
  searchQuery,
  loading,
  errorMessage,
  displayContacts,
  selectedAddressBook,
  selectedContact,
  initialized,
  showDialog,
  editMode,
  editingContact,
  contactLabel,
  initials,
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
} = useContactsView()

onMounted(loadInitial)
</script>

<style scoped>
.contacts-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 16px;
  gap: 16px;
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}
.page-title-row {
  display: flex;
  align-items: center;
  gap: 4px;
}
.page-title {
  font-size: 1.25rem;
  font-weight: 600;
}
.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.addressbook-select {
  /* Fixed width: vue-select sizes to the selected text, which it hides while open,
     so a content-sized select shrank on click. */
  width: 240px;
  flex: none;
}

.file-input-hidden {
  display: none;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 48px;
  color: var(--oc-role-on-surface-variant, #40484c);
}
.empty-state-sm {
  padding: 16px;
  text-align: center;
  font-size: 0.875rem;
  color: var(--oc-role-on-surface-variant, #40484c);
}

.error-banner {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  background: var(--oc-role-error-container, #ffdad6);
  border-radius: 8px;
  padding: 16px;
  color: var(--oc-role-on-error-container, #410002);
}
.error-text {
  font-size: 0.875rem;
}

.search-wrap :deep(.oc-text-input) {
  margin-bottom: 0;
}

.split-view {
  flex: 1;
  display: flex;
  gap: 16px;
  min-height: 0;
  overflow: hidden;
}

.contact-list {
  width: 320px;
  flex-shrink: 0;
  overflow-y: auto;
  border: 1px solid var(--oc-role-outline-variant, #bfc8cc);
  border-radius: 12px;
  background: var(--oc-role-surface-container-lowest, #ffffff);
}

.contact-row {
  width: 100%;
  text-align: left;
  padding: 12px 16px;
  border: none;
  border-bottom: 1px solid var(--oc-role-surface-container, #eceef0);
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  background: transparent;
  color: inherit;
  /* Native virtualization: offscreen rows skip layout/paint entirely, keeping
     multi-thousand-contact lists smooth without a virtual-scroll dependency.
     The intrinsic size (avatar 40px + 2×12px padding + border) preserves a
     stable scrollbar. */
  content-visibility: auto;
  contain-intrinsic-size: auto 65px;
}
.contact-row:hover {
  background: var(--oc-role-surface-container-low, #f2f4f5);
}
.contact-row.is-selected {
  background: var(--oc-role-secondary-container, #cfe6f1);
}

.avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-weight: 600;
  font-size: 0.875rem;
  flex-shrink: 0;
}
.avatar-photo {
  object-fit: cover;
}

.contact-info {
  min-width: 0;
}
.contact-name {
  font-weight: 500;
  font-size: 0.875rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.contact-sub {
  font-size: 0.75rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--oc-role-on-surface-variant, #40484c);
}

.contact-detail-pane {
  flex: 1;
  position: relative;
  overflow-y: auto;
  border: 1px solid var(--oc-role-outline-variant, #bfc8cc);
  border-radius: 12px;
  padding: 24px;
  background: var(--oc-role-surface-container-lowest, #ffffff);
}

.contact-detail-close {
  display: none;
}

@media (max-width: 640px) {
  /* 1. Single-box drill-in: list first, selected contact replaces it */
  .split-view {
    display: block;
    overflow: hidden;
  }
  .is-contact-detail-open .search-wrap {
    display: none;
  }
  .contact-list {
    width: 100%;
    height: 100%;
  }
  .split-view.is-detail-open .contact-list {
    display: none;
  }
  .split-view:not(.is-detail-open) .contact-detail-pane {
    display: none;
  }
  .contact-detail-pane {
    height: 100%;
    padding: 16px;
    padding-top: 48px;
  }
  .contact-detail-close {
    position: absolute;
    top: 10px;
    right: 10px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--oc-role-on-surface-variant, #40484c);
    cursor: pointer;
  }
  .contact-detail-close:hover,
  .contact-detail-close:focus-visible {
    background: var(--oc-role-surface-container-low, #f5f6f8);
    outline: none;
  }

  /* 3. Reduce page padding */
  .contacts-page {
    padding: 8px;
  }

  /* 4. Prevent toolbar-actions from overflowing narrow screens */
  .toolbar-actions {
    flex-wrap: wrap;
  }
  .addressbook-select {
    min-width: 0;
    width: 100%;
  }
}
</style>
