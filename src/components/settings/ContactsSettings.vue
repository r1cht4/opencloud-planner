<template>
  <SettingsSection :title="$gettext('Contacts')">
    <SettingsRow
      :label="$gettext('Default address book')"
      :hint="
        $gettext(
          'Opened first in Contacts. An address book that no longer exists falls back to the first one.'
        )
      "
      :locked="isLocked('contacts.defaultAddressBook')"
      label-for="setting-contacts-default-address-book"
    >
      <select
        id="setting-contacts-default-address-book"
        class="settings-select"
        data-setting="contacts.defaultAddressBook"
        :value="settings.contacts.defaultAddressBook ?? ''"
        :disabled="isLocked('contacts.defaultAddressBook')"
        @change="update('contacts.defaultAddressBook', optionalUrl($event))"
      >
        <option value="">{{ $gettext('First address book') }}</option>
        <option v-for="book in choices" :key="book.url" :value="book.url">
          {{ book.displayName }}
        </option>
      </select>
    </SettingsRow>

    <SettingsRow
      :label="$gettext('Sort contacts by')"
      :locked="isLocked('contacts.sortBy')"
      label-for="setting-contacts-sort-by"
    >
      <select
        id="setting-contacts-sort-by"
        class="settings-select"
        data-setting="contacts.sortBy"
        :value="settings.contacts.sortBy"
        :disabled="isLocked('contacts.sortBy')"
        @change="update('contacts.sortBy', valueOf($event))"
      >
        <option value="lastName">{{ $gettext('Last name') }}</option>
        <option value="firstName">{{ $gettext('First name') }}</option>
      </select>
    </SettingsRow>

    <SettingsRow
      :label="$gettext('Show names as')"
      :hint="
        $gettext('Only the list is formatted — the stored name of a contact is never changed.')
      "
      :locked="isLocked('contacts.displayOrder')"
      label-for="setting-contacts-display-order"
    >
      <select
        id="setting-contacts-display-order"
        class="settings-select"
        data-setting="contacts.displayOrder"
        :value="settings.contacts.displayOrder"
        :disabled="isLocked('contacts.displayOrder')"
        @change="update('contacts.displayOrder', valueOf($event))"
      >
        <option value="firstLast">{{ $gettext('First name Last name') }}</option>
        <option value="lastFirst">{{ $gettext('Last name, First name') }}</option>
      </select>
    </SettingsRow>
  </SettingsSection>
</template>

<script setup lang="ts">
/**
 * Settings → Contacts → group "Contacts": default address book, sort field and
 * the display order of names.
 *
 * Consumed by `views/Contacts.vue` through `settings/contactList.ts`; the display
 * order only formats the list label, so the vCard (`FN`, `N`) stays untouched.
 */
import { useGettext } from 'vue3-gettext'
import { useSettings } from '../../settings/settingsStore'
import { useAddressBookChoices } from './useCollectionChoices'
import SettingsSection from './SettingsSection.vue'
import SettingsRow from './SettingsRow.vue'
import { optionalUrl, valueOf } from './settingsForm'
import '../../styles/settings.css'

defineOptions({ name: 'ContactsSettings' })

const { $gettext } = useGettext()
const { settings, update, isLocked } = useSettings()
const { choices } = useAddressBookChoices()
</script>
