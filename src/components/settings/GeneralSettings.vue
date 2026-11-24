<template>
  <SettingsSection :title="$gettext('Apps')">
    <SettingsRow
      v-for="key in APP_KEYS"
      :key="key"
      :label="appLabel(key)"
      :hint="appHint(key)"
      :locked="appLocked(key)"
      :label-for="`setting-general-app-${key}`"
    >
      <input
        :id="`setting-general-app-${key}`"
        :checked="isAppEnabled(key)"
        :data-setting="`general.enabledApps.${key}`"
        type="checkbox"
        class="settings-checkbox"
        :disabled="isAppDisabled(key)"
        @change="onToggleApp(key, ($event.target as HTMLInputElement).checked)"
      />
    </SettingsRow>

    <SettingsRow
      :label="$gettext('Default app')"
      :hint="$gettext('Opened from the app menu and after starting the app.')"
      :locked="isLocked('general.defaultApp')"
      label-for="setting-general-default-app"
    >
      <select
        id="setting-general-default-app"
        class="settings-select"
        data-setting="general.defaultApp"
        :value="settings.general.defaultApp"
        :disabled="isLocked('general.defaultApp')"
        @change="update('general.defaultApp', valueOf($event))"
      >
        <option v-for="key in enabledAppKeys" :key="key" :value="key">
          {{ appLabel(key) }}
        </option>
      </select>
    </SettingsRow>

    <SettingsRow
      :label="$gettext('Navigation')"
      :hint="navigationHint"
      :locked="isLocked('general.navigation')"
      label-for="setting-general-navigation"
    >
      <!-- `settings-inline--solo`: without the gear the select takes the whole
           control width, lining up with the plain selects of the rows above. -->
      <div
        class="settings-inline"
        :class="{ 'settings-inline--solo': settings.general.navigation !== 'filesSidebar' }"
      >
        <select
          id="setting-general-navigation"
          class="settings-select"
          data-setting="general.navigation"
          :value="settings.general.navigation"
          :disabled="isLocked('general.navigation')"
          @change="update('general.navigation', valueOf($event))"
        >
          <option value="filesSidebar">{{ $gettext('Files sidebar') }}</option>
          <option value="drawerOnly">{{ $gettext('App menu only') }}</option>
        </select>
        <!-- Only in Files-sidebar mode: there is nothing to arrange otherwise. -->
        <oc-button
          v-if="settings.general.navigation === 'filesSidebar'"
          class="settings-gear"
          appearance="raw"
          size="small"
          data-toggle="general.filesSidebarPosition"
          :aria-label="$gettext('Arrange apps in the Files sidebar')"
          :title="$gettext('Arrange apps in the Files sidebar')"
          :aria-expanded="navigationExpanded ? 'true' : 'false'"
          @click="navigationExpanded = !navigationExpanded"
        >
          <oc-icon name="settings-3" size="small" />
        </oc-button>
      </div>
    </SettingsRow>

    <!-- Where each app sits in the Files sidebar: one line per app in the order
         of the order setting, collapsed until the gear above is pressed. -->
    <template v-if="settings.general.navigation === 'filesSidebar' && navigationExpanded">
      <SettingsRow
        v-for="(key, index) in filesSidebarRows"
        :key="`files-sidebar-${key}`"
        :label="appLabel(key)"
        :locked="filesSidebarLocked || positionLocked || filesSidebarOrderLocked"
        :label-for="`setting-general-files-sidebar-${key}`"
      >
        <template #label-actions>
          <span class="settings-move-group">
            <oc-button
              class="settings-move"
              appearance="raw"
              size="small"
              :data-setting="`general.filesSidebarOrder.${key}.up`"
              :aria-label="$gettext('Move %{app} up', { app: appLabel(key) })"
              :title="$gettext('Move %{app} up', { app: appLabel(key) })"
              :disabled="filesSidebarOrderLocked || index === 0"
              @click="moveApp('filesSidebarOrder', key, -1)"
            >
              <oc-icon name="arrow-up-s" size="small" />
            </oc-button>
            <oc-button
              class="settings-move"
              appearance="raw"
              size="small"
              :data-setting="`general.filesSidebarOrder.${key}.down`"
              :aria-label="$gettext('Move %{app} down', { app: appLabel(key) })"
              :title="$gettext('Move %{app} down', { app: appLabel(key) })"
              :disabled="filesSidebarOrderLocked || index === filesSidebarRows.length - 1"
              @click="moveApp('filesSidebarOrder', key, 1)"
            >
              <oc-icon name="arrow-down-s" size="small" />
            </oc-button>
          </span>
        </template>
        <div class="settings-inline">
          <select
            class="settings-select"
            :data-setting="`general.filesSidebarPosition.${key}`"
            :value="filesSidebarSlotFor(key)"
            :aria-label="
              $gettext('Position of %{app} in the Files sidebar', { app: appLabel(key) })
            "
            :disabled="filesSidebarLocked || positionLocked"
            @change="onChangeFilesSidebarPosition(key, valueOf($event))"
          >
            <option v-for="slot in FILES_SIDEBAR_SLOTS" :key="slot" :value="slot">
              {{ filesSidebarSlotLabel(slot) }}
            </option>
          </select>
          <input
            :id="`setting-general-files-sidebar-${key}`"
            :checked="isInFilesSidebar(key)"
            :data-setting="`general.filesSidebar.${key}`"
            type="checkbox"
            class="settings-checkbox"
            :aria-label="$gettext('Show %{app} in the Files sidebar', { app: appLabel(key) })"
            :disabled="filesSidebarLocked"
            @change="onToggleFilesSidebar(key, ($event.target as HTMLInputElement).checked)"
          />
        </div>
      </SettingsRow>
    </template>

    <SettingsRow
      :label="$gettext('App menu')"
      :hint="drawerHint"
      :locked="isLocked('general.appDrawer')"
      label-for="setting-general-app-drawer"
    >
      <div class="settings-inline">
        <select
          id="setting-general-app-drawer"
          class="settings-select"
          data-setting="general.appDrawer"
          :value="settings.general.appDrawer"
          :disabled="isLocked('general.appDrawer')"
          @change="update('general.appDrawer', valueOf($event))"
        >
          <option value="single">{{ $gettext('One entry') }}</option>
          <option value="individual">{{ $gettext('One entry per app') }}</option>
        </select>
        <oc-button
          class="settings-gear"
          appearance="raw"
          size="small"
          data-toggle="general.appDrawerPosition"
          :aria-label="$gettext('Arrange apps in the app menu')"
          :title="$gettext('Arrange apps in the app menu')"
          :aria-expanded="appDrawerExpanded ? 'true' : 'false'"
          @click="appDrawerExpanded = !appDrawerExpanded"
        >
          <oc-icon name="settings-3" size="small" />
        </oc-button>
      </div>
    </SettingsRow>

    <!-- Where the app-menu entry sits. One row for the package in "One entry"
         mode, one per app otherwise; collapsed until the gear is pressed. -->
    <template v-if="appDrawerExpanded">
      <SettingsRow
        v-if="settings.general.appDrawer === 'single'"
        :label="APP_NAME"
        :locked="drawerPositionLocked"
        label-for="setting-general-app-drawer-position"
      >
        <div class="settings-inline">
          <select
            id="setting-general-app-drawer-position"
            class="settings-select"
            data-setting="general.appDrawerPosition"
            :value="appDrawerSlotFor(singleDrawerAppKey)"
            :aria-label="$gettext('Position of %{app} in the app menu', { app: APP_NAME })"
            :disabled="drawerPositionLocked"
            @change="onChangeAppDrawerPosition(singleDrawerAppKey, valueOf($event))"
          >
            <option v-for="slot in APP_DRAWER_SLOTS" :key="slot" :value="slot">
              {{ appDrawerSlotLabel(slot) }}
            </option>
          </select>
          <!-- No checkbox: hiding the only app-menu entry would leave no way to
               open the app. The slot above still aligns with the rows below. -->
          <span class="settings-inline-spacer" aria-hidden="true" />
        </div>
      </SettingsRow>

      <template v-else>
        <SettingsRow
          v-for="(key, index) in appDrawerRows"
          :key="`app-drawer-${key}`"
          :label="appLabel(key)"
          :locked="drawerAppsLocked || drawerPositionLocked || appDrawerOrderLocked"
          :label-for="`setting-general-app-drawer-${key}`"
        >
          <template #label-actions>
            <span class="settings-move-group">
              <oc-button
                class="settings-move"
                appearance="raw"
                size="small"
                :data-setting="`general.appDrawerOrder.${key}.up`"
                :aria-label="$gettext('Move %{app} up', { app: appLabel(key) })"
                :title="$gettext('Move %{app} up', { app: appLabel(key) })"
                :disabled="appDrawerOrderLocked || index === 0"
                @click="moveApp('appDrawerOrder', key, -1)"
              >
                <oc-icon name="arrow-up-s" size="small" />
              </oc-button>
              <oc-button
                class="settings-move"
                appearance="raw"
                size="small"
                :data-setting="`general.appDrawerOrder.${key}.down`"
                :aria-label="$gettext('Move %{app} down', { app: appLabel(key) })"
                :title="$gettext('Move %{app} down', { app: appLabel(key) })"
                :disabled="appDrawerOrderLocked || index === appDrawerRows.length - 1"
                @click="moveApp('appDrawerOrder', key, 1)"
              >
                <oc-icon name="arrow-down-s" size="small" />
              </oc-button>
            </span>
          </template>
          <div class="settings-inline">
            <select
              class="settings-select"
              :data-setting="`general.appDrawerPosition.${key}`"
              :value="appDrawerSlotFor(key)"
              :aria-label="$gettext('Position of %{app} in the app menu', { app: appLabel(key) })"
              :disabled="drawerPositionLocked"
              @change="onChangeAppDrawerPosition(key, valueOf($event))"
            >
              <option v-for="slot in APP_DRAWER_SLOTS" :key="slot" :value="slot">
                {{ appDrawerSlotLabel(slot) }}
              </option>
            </select>
            <input
              :id="`setting-general-app-drawer-${key}`"
              :checked="isInAppDrawer(key)"
              :data-setting="`general.appDrawerApps.${key}`"
              type="checkbox"
              class="settings-checkbox"
              :aria-label="$gettext('Show %{app} in the app menu', { app: appLabel(key) })"
              :disabled="drawerAppsLocked || isLastDrawerApp(key)"
              @change="onToggleDrawerApp(key, ($event.target as HTMLInputElement).checked)"
            />
          </div>
        </SettingsRow>
      </template>
    </template>
  </SettingsSection>

  <!-- Right column: stacks on its own, so opening a group on the left never moves it. -->
  <div class="general-side">
    <SettingsSection :title="$gettext('Reminders')">
      <RemindersSettings
        :enabled="settings.reminders.enabled"
        :locked="isLocked('reminders.enabled')"
        @update:enabled="update('reminders.enabled', $event)"
      />
    </SettingsSection>

    <SettingsSection :title="$gettext('Format')">
      <FormatSettings />
    </SettingsSection>
  </div>
</template>

<script setup lang="ts">
/**
 * Settings → General — three groups: which apps exist (`Apps`: the enabled apps,
 * the navigation mode, the app-menu mode, the default app and the per-app
 * Files-sidebar membership), how dates and times are formatted (`Format`) and the
 * browser reminders (`Reminders`).
 *
 * The per-app rows are one *place* setting each — where the entry sits (a slot
 * select) and whether it exists (a checkbox) — and stay collapsed until the small
 * gear next to the mode select is pressed:
 * - Navigation `filesSidebar` → one row per enabled app with its position in the
 *   Files sidebar (`general.filesSidebarPosition`) and its on/off checkbox
 *   (`general.filesSidebar`). A mode without Files-sidebar entries has nothing to
 *   arrange, so that gear only exists in Files-sidebar mode.
 * - App menu → one row per enabled app with its position among the host's own
 *   entries (`general.appDrawerPosition`) and its checkbox
 *   (`general.appDrawerApps`); in `single` mode the one "Planner" row takes the
 *   slot of the default app — the app that entry opens — and has no checkbox
 *   (hiding it would leave no way into the app at all).
 *
 * The rows are listed in the order the entries appear (`general.filesSidebarOrder`
 * / `general.appDrawerOrder`), and the two small arrow buttons next to each label
 * swap an app with its neighbour: two apps in the same slot would otherwise keep
 * Calendar < Contacts < Tasks. The buttons sit in the label column on purpose, so
 * the select and checkbox columns of the rows above stay aligned.
 *
 * `general.filesSidebar` is a list of apps, so each *enabled* app gets its own
 * checkbox there; apps the user turned off are not listed (they cannot appear in
 * the Files sidebar either — the effective list is `filesSidebar ∩ enabled apps`),
 * but their stored membership is preserved for when they come back.
 *
 * Values an admin locked render read-only, apps the admin disabled cannot be
 * re-enabled; both are marked by the lock icon of the row.
 */
import { computed, ref } from 'vue'
import { useGettext } from 'vue3-gettext'
import { useSettings } from '../../settings/settingsStore'
import { getAdminConfig } from '../../config/appConfig'
import {
  APP_KEYS,
  APP_NAME,
  appDrawerSlot,
  effectiveDefaultApp,
  filesSidebarSlot,
  orderedApps
} from '../../navigation'
import {
  APP_DRAWER_SLOTS,
  FILES_SIDEBAR_SLOTS,
  type AppDrawerSlot,
  type AppKey,
  type FilesSidebarSlot
} from '../../settings/schema'
import SettingsSection from './SettingsSection.vue'
import SettingsRow from './SettingsRow.vue'
import FormatSettings from './FormatSettings.vue'
import RemindersSettings from './RemindersSettings.vue'
import { valueOf } from './settingsForm'

defineOptions({ name: 'GeneralSettings' })

const { $gettext } = useGettext()
const { settings, update, isLocked } = useSettings()

const APP_LABELS: Record<AppKey, string> = {
  calendar: 'Calendar',
  contacts: 'Contacts',
  tasks: 'Tasks'
}

function appLabel(key: AppKey): string {
  return $gettext(APP_LABELS[key])
}

// ── General: enabled apps ───────────────────────────────────────────────────
const adminEnabledApps = computed<AppKey[]>(() => getAdminConfig().enabledApps ?? APP_KEYS)

function isAppEnabled(key: AppKey): boolean {
  return adminEnabledApps.value.includes(key) && settings.value.general.enabledApps.includes(key)
}

function isAppDisabled(key: AppKey): boolean {
  if (!adminEnabledApps.value.includes(key)) return true
  if (isLocked('general.enabledApps')) return true
  // Unchecking the last enabled app would leave the app without any entry.
  return isAppEnabled(key) && settings.value.general.enabledApps.length === 1
}

/** Admin-locked or admin-disabled — both are "set by your administrator". */
function appLocked(key: AppKey): boolean {
  return isLocked('general.enabledApps') || !adminEnabledApps.value.includes(key)
}

function appHint(key: AppKey): string {
  if (!adminEnabledApps.value.includes(key)) return $gettext('Disabled by your administrator.')
  if (isLocked('general.enabledApps')) return $gettext('Set by your administrator.')
  if (isAppDisabled(key)) return $gettext('At least one app must remain enabled.')
  return ''
}

function onToggleApp(key: AppKey, checked: boolean): void {
  const current = settings.value.general.enabledApps
  const next = checked
    ? [...current, key].filter((entry, index, all) => all.indexOf(entry) === index)
    : current.filter((entry) => entry !== key)
  if (next.length === 0) return
  update('general.enabledApps', next)
}

// ── General: navigation mode ───────────────────────────────────────────────
/**
 * One line explaining the selected mode: the two modes are an either/or, and the
 * hint has to fit on one line next to the label. The drawer-only mode gets its
 * own hint — the app-menu row below shows the "one entry" line in that mode, and
 * the Navigation row must not repeat it.
 */
const navigationHint = computed(() =>
  settings.value.general.navigation === 'filesSidebar'
    ? $gettext('Calendar, Contacts and Tasks appear in the Files sidebar.')
    : $gettext('Nothing in the Files sidebar; open the apps from the app menu.')
)

/**
 * The per-app rows are a disclosure: collapsed on every mount (the state is not
 * persisted — it is a way to look at the arrangement, not a setting).
 */
const navigationExpanded = ref(false)
const appDrawerExpanded = ref(false)

// ── General: app menu mode ──────────────────────────────────────────────────
/** One line per mode: what the drawer shows. */
const drawerHint = computed(() =>
  settings.value.general.appDrawer === 'individual'
    ? $gettext('One entry per app; pick the apps below.')
    : $gettext('One %{app} entry in the app menu; switch apps in the sidebar.', { app: APP_NAME })
)

const drawerAppsLocked = computed(() => isLocked('general.appDrawerApps'))

function isInAppDrawer(key: AppKey): boolean {
  const picked = settings.value.general.appDrawerApps
  return picked.includes(key) || picked.length === 0
}

/** At least one entry must remain, otherwise the app could not be opened. */
function isLastDrawerApp(key: AppKey): boolean {
  const picked = settings.value.general.appDrawerApps
  return (
    picked.includes(key) &&
    picked.filter((entry) => enabledAppKeys.value.includes(entry)).length <= 1
  )
}

function onToggleDrawerApp(key: AppKey, checked: boolean): void {
  const current = settings.value.general.appDrawerApps
  const next = checked
    ? [...current, key].filter((entry, index, all) => all.indexOf(entry) === index)
    : current.filter((entry) => entry !== key)
  if (next.length === 0) return
  update('general.appDrawerApps', next)
}

// ── General: Files sidebar (per app) ────────────────────────────────────────
const filesSidebarLocked = computed(() => isLocked('general.filesSidebar'))
const positionLocked = computed(() => isLocked('general.filesSidebarPosition'))
const filesSidebarOrderLocked = computed(() => isLocked('general.filesSidebarOrder'))

/**
 * The Files-sidebar rows, in the order the entries appear in the sidebar
 * (`general.filesSidebarOrder`), limited to the enabled apps — a disabled app
 * cannot appear there, so it gets no row.
 */
const filesSidebarRows = computed<AppKey[]>(() =>
  orderedApps(settings.value.general.filesSidebarOrder).filter((key) =>
    enabledAppKeys.value.includes(key)
  )
)

function filesSidebarSlotFor(key: AppKey): FilesSidebarSlot {
  return filesSidebarSlot(settings.value, key)
}

/**
 * Slot labels; `After …` names the host entry we sit behind.
 *
 * One function per slot with a literal gettext call: the extractor only sees
 * literal arguments, so an indexed lookup would leave the five labels
 * untranslated.
 */
const FILES_SLOT_LABELS: Record<FilesSidebarSlot, () => string> = {
  personal: () => $gettext('After Personal'),
  favorites: () => $gettext('After Favorites'),
  shares: () => $gettext('After Shares'),
  spaces: () => $gettext('After Spaces'),
  deleted: () => $gettext('After Deleted files')
}

function filesSidebarSlotLabel(slot: FilesSidebarSlot): string {
  return FILES_SLOT_LABELS[slot]()
}

// ── General: app menu (per app) ─────────────────────────────────────────────
/**
 * Slot labels of the app menu. `After the other apps` is Contacts/Mail/App Store:
 * they all sit at the host priority 30, so they cannot be separated.
 */
const DRAWER_SLOT_LABELS: Record<AppDrawerSlot, () => string> = {
  first: () => $gettext('First'),
  afterFiles: () => $gettext('After Files'),
  afterApps: () => $gettext('After the other apps'),
  afterSettings: () => $gettext('After Admin Settings'),
  last: () => $gettext('Last')
}

function appDrawerSlotLabel(slot: AppDrawerSlot): string {
  return DRAWER_SLOT_LABELS[slot]()
}

const drawerPositionLocked = computed(() => isLocked('general.appDrawerPosition'))
const appDrawerOrderLocked = computed(() => isLocked('general.appDrawerOrder'))

/** The per-app app-menu rows, in `general.appDrawerOrder` (enabled apps only). */
const appDrawerRows = computed<AppKey[]>(() =>
  orderedApps(settings.value.general.appDrawerOrder).filter((key) =>
    enabledAppKeys.value.includes(key)
  )
)

function appDrawerSlotFor(key: AppKey): AppDrawerSlot {
  return appDrawerSlot(settings.value, key)
}

function onChangeAppDrawerPosition(key: AppKey, slot: string): void {
  if (!APP_DRAWER_SLOTS.includes(slot as AppDrawerSlot)) return
  update('general.appDrawerPosition', {
    ...settings.value.general.appDrawerPosition,
    [key]: slot
  })
}

/**
 * App whose slot the single app-menu entry uses — the app that entry opens. The
 * same enabled-aware rule as the entry itself (`effectiveDefaultApp`), so this
 * row always arranges the entry the user gets, even when the stored default app
 * was disabled in the meantime.
 */
const singleDrawerAppKey = computed<AppKey>(() =>
  effectiveDefaultApp(enabledAppKeys.value, settings.value.general.defaultApp)
)

function onChangeFilesSidebarPosition(key: AppKey, slot: string): void {
  if (!FILES_SIDEBAR_SLOTS.includes(slot as FilesSidebarSlot)) return
  update('general.filesSidebarPosition', {
    ...settings.value.general.filesSidebarPosition,
    [key]: slot
  })
}

/** One row per app that is actually enabled (admin ∩ user). */
const enabledAppKeys = computed<AppKey[]>(() => APP_KEYS.filter((key) => isAppEnabled(key)))

function isInFilesSidebar(key: AppKey): boolean {
  return settings.value.general.filesSidebar.includes(key)
}

function onToggleFilesSidebar(key: AppKey, checked: boolean): void {
  const current = settings.value.general.filesSidebar
  const next = checked ? [...current, key] : current.filter((entry) => entry !== key)
  update(
    'general.filesSidebar',
    [...new Set(next)].filter((entry) => APP_KEYS.includes(entry))
  )
}

// ── General: order of the apps inside their slot ────────────────────────────
/** The setting behind one gear section's order, per target. */
type OrderField = 'filesSidebarOrder' | 'appDrawerOrder'

/**
 * Move an app one row up or down.
 *
 * The rows list only the enabled apps, but the setting holds all three, so the
 * move swaps the two *visible* neighbours at their own positions in the stored
 * list: an app that has no row keeps its place between them.
 */
function moveApp(field: OrderField, key: AppKey, offset: number): void {
  const rows = field === 'filesSidebarOrder' ? filesSidebarRows.value : appDrawerRows.value
  const from = rows.indexOf(key)
  const to = from + offset
  if (from < 0 || to < 0 || to >= rows.length) return

  const next = [...settings.value.general[field]]
  const target = rows[to]
  const a = next.indexOf(key)
  const b = next.indexOf(target)
  if (a < 0 || b < 0) return
  next[a] = target
  next[b] = key
  update(`general.${field}`, next)
}
</script>
