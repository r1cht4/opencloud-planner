<template>
  <main ref="pageElement" class="settings-page">
    <div class="settings-toolbar">
      <h1 class="page-title">{{ $gettext('Settings') }}</h1>
    </div>

    <p v-if="error" class="settings-error" role="alert">
      {{ $gettext('Your settings could not be saved.') }} ({{ error }})
    </p>

    <SettingsTabs
      :model-value="activeSection"
      :sections="sections"
      @update:model-value="openSection"
    />

    <div
      :id="`settings-panel-${activeSection}`"
      class="settings-panel"
      role="tabpanel"
      :aria-labelledby="`settings-tab-${activeSection}`"
      :data-tab="activeSection"
      tabindex="0"
    >
      <GeneralSettings v-if="activeSection === 'general'" />

      <CalendarSettings v-else-if="activeSection === 'calendar'" />

      <template v-else-if="activeSection === 'contacts'">
        <ContactsSettings />
        <BirthdaysSettings />
      </template>

      <TasksSettings v-else-if="activeSection === 'tasks'" />

      <DataSettings
        v-else-if="activeSection === 'data'"
        :refresh-key="collectionsVersion"
        @changed="bumpCollections"
      />

      <SettingsSection
        v-else-if="activeSection === 'devices'"
        :title="$gettext('Connect your devices')"
        :hint="
          $gettext(
            'Sync your calendars and contacts with native apps on your phone or desktop using these addresses.'
          )
        "
        wide
      >
        <ConnectDevices />
      </SettingsSection>

      <SettingsSection v-else-if="activeSection === 'about'" :title="$gettext('Status')" wide>
        <AboutStatus />
      </SettingsSection>
    </div>
  </main>
</template>

<script setup lang="ts">
/**
 * Settings page — the ⚙ target of every app view.
 *
 * Seven tabs, each a small grid of group cards (see `SettingsSection.vue` and
 * `SettingsRow.vue`) instead of one long page: General (apps, navigation, format,
 * reminders), Calendar, Contacts + Birthdays, Tasks, Data (collections,
 * import/export, backup, clean up), Devices (native clients) and About (status).
 * Only the active tab is rendered.
 *
 * There is **no Back button** here — the in-app sidebar carries "Back to OpenCloud"
 * on every page — and the URL never names the tab: the view that opens Settings
 * requests the tab in memory (`settings/pendingTab.ts`).
 *
 * Settings are synced per user (Radicale principal dead property) — see
 * `useSettings()`. The page itself only owns the chrome (tabs, save error) and the
 * collection-refresh counter the Data tab shares with its cards.
 */
import { computed, ref, watch } from 'vue'
import { useGettext } from 'vue3-gettext'
import { useMessages } from '@opencloud-eu/web-pkg'
import { useSettings } from '../settings/settingsStore'
import { takeSettingsTab } from '../settings/pendingTab'
import {
  DEFAULT_SETTINGS_SECTION,
  SETTINGS_SECTION_IDS,
  isSettingsSectionId,
  type SettingsSectionId
} from '../navigation'
import SettingsTabs from '../components/settings/SettingsTabs.vue'
import SettingsSection from '../components/settings/SettingsSection.vue'
import GeneralSettings from '../components/settings/GeneralSettings.vue'
import CalendarSettings from '../components/settings/CalendarSettings.vue'
import ContactsSettings from '../components/settings/ContactsSettings.vue'
import BirthdaysSettings from '../components/settings/BirthdaysSettings.vue'
import TasksSettings from '../components/settings/TasksSettings.vue'
import DataSettings from '../components/settings/DataSettings.vue'
import ConnectDevices from '../components/ConnectDevices.vue'
import AboutStatus from '../components/settings/AboutStatus.vue'
import '../styles/modal.css'
import '../styles/settings.css'

defineOptions({ name: 'SettingsView' })

const { $gettext } = useGettext()
const { showErrorMessage } = useMessages()
const { error } = useSettings()

// ── Tabs ────────────────────────────────────────────────────────────────────
/**
 * Tab labels, in `SETTINGS_SECTION_IDS` order. Literal `$gettext` calls: the
 * extractor only sees literal arguments, so an indexed lookup would leave the
 * labels untranslated.
 */
function sectionLabel(id: SettingsSectionId): string {
  switch (id) {
    case 'general':
      return $gettext('General')
    case 'calendar':
      return $gettext('Calendar')
    case 'contacts':
      return $gettext('Contacts')
    case 'tasks':
      return $gettext('Tasks')
    case 'data':
      return $gettext('Data')
    case 'devices':
      return $gettext('Devices')
    case 'about':
      return $gettext('About')
  }
}

const sections = computed(() => SETTINGS_SECTION_IDS.map((id) => ({ id, label: sectionLabel(id) })))

/** The scrolling element — the tab bar is sticky inside it. */
const pageElement = ref<HTMLElement | null>(null)

/**
 * The open tab.
 *
 * The URL never carries it (user decision: no `#<tab>`, no query) — the page that
 * opened Settings hands the wanted tab over in memory (`settings/pendingTab.ts`),
 * and it is taken exactly once here. A plain visit, a reload or a bookmark lands
 * on General.
 */
const requested = takeSettingsTab()
const activeSection = ref<SettingsSectionId>(
  isSettingsSectionId(requested) ? requested : DEFAULT_SETTINGS_SECTION
)

/**
 * Switch tabs: only that panel is rendered, so there is nothing to scroll to —
 * the page goes back to the top instead.
 */
function openSection(id: string): void {
  if (!isSettingsSectionId(id)) return
  activeSection.value = id
  if (pageElement.value) pageElement.value.scrollTop = 0
}

// ── Data: collection changes ────────────────────────────────────────────────
/**
 * The collection manager (create/rename/color/delete) sits next to the import and
 * backup cards; bumping this key makes their collection selectors follow the
 * change. `changed` is emitted by the cards that can create a collection.
 */
const collectionsVersion = ref(0)

function bumpCollections(): void {
  collectionsVersion.value++
}

// A failed save must be visible: the store keeps the optimistic value and sets
// `error`, which we surface as a toast on top of the inline alert.
watch(error, (message) => {
  if (!message) return
  showErrorMessage({ title: $gettext('Your settings could not be saved.') })
})
</script>

<style scoped>
.settings-page {
  /* Page insets and the width of the content column. The sticky tab bar reads
     both, so tabs and cards line up. */
  --settings-gutter: 16px;
  --settings-column: 1100px;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 0;
  gap: 16px;
  /* This element — not the host's content area — is the scrollport of the page
     (same `height: 100%` contract as Calendar/Contacts/Tasks), which is what
     makes `position: sticky` on the tab bar work. Keep `overflow` off every
     wrapper between the bar and this element: an `overflow: hidden` ancestor
     silently disables sticky. */
  overflow-y: auto;
}

/* Nothing in the page may be compressed: the page is a column flex container
   with a definite height, so the browser would otherwise shrink the toolbar and
   the (overflow-clipping) tab bar down to their flex minimum, i.e. to zero. Only
   `.settings-page` scrolls; its children keep their height. */
.settings-page > * {
  flex: 0 0 auto;
}

.settings-toolbar {
  width: 100%;
  max-width: var(--settings-column);
  margin: 0 auto;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: var(--settings-gutter) var(--settings-gutter) 0;
}

.page-title {
  font-size: 1.25rem;
  font-weight: 600;
}

.settings-error {
  width: 100%;
  max-width: var(--settings-column);
  margin: 0 auto;
  box-sizing: border-box;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid var(--oc-role-error, #b3261e);
  background: var(--oc-role-error-container, #f9dedc);
  color: var(--oc-role-on-error-container, #410e0b);
  font-size: 0.8125rem;
}

/* The content column: one column of group cards, two from 1100px up. */
.settings-panel {
  width: 100%;
  max-width: var(--settings-column);
  margin: 0 auto;
  box-sizing: border-box;
  padding: 0 var(--settings-gutter) var(--settings-gutter);
  display: flex;
  flex-direction: column;
  gap: 16px;
}

@media (min-width: 768px) {
  .settings-page {
    --settings-gutter: 24px;
  }
}

/* General tab: Reminders + Format share the right column as one flex stack. */
:deep(.general-side) {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

@media (min-width: 1100px) {
  .settings-panel {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    align-items: start;
  }

  /* A collapsed card (Data → Clean up) takes the height of its row neighbour
     (Backup & restore); opened, it keeps its natural height. */
  .settings-panel > :deep(.settings-section--collapsible:not([open])) {
    align-self: stretch;
  }
}
</style>
