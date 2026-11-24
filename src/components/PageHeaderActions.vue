<template>
  <router-link
    class="page-header-action"
    :to="SETTINGS_TARGET"
    :aria-label="$gettext('Settings')"
    :title="$gettext('Settings')"
    @click="requestTab"
  >
    <oc-icon name="settings-3" size="small" />
  </router-link>
</template>

<script setup lang="ts">
/**
 * Page-header actions shared by every app view.
 *
 * Today that is the ⚙ button that opens Settings — one icon-only control at the
 * right of the `.page-title` row, so Settings is reachable from Calendar,
 * Contacts and Tasks without a sidebar entry.
 *
 * The URL of the Settings page stays plain (`/planner/settings`): the
 * tab that belongs to this page (`Calendar` → Calendar, Contacts → Contacts,
 * Tasks → Tasks, anything else → General) is handed over **in memory** right
 * before the navigation (`settings/pendingTab.ts`), so nothing leaks into the
 * address bar and a bookmark never restores a random tab.
 */
import { computed } from 'vue'
import { useGettext } from 'vue3-gettext'
// web-pkg's useRoute resolves the host router (a Ref); vue-router's own one is undefined here.
import { useRoute } from '@opencloud-eu/web-pkg'
import { SETTINGS_TARGET, settingsSectionForPath } from '../navigation'
import { requestSettingsTab } from '../settings/pendingTab'

defineOptions({ name: 'PageHeaderActions' })

const { $gettext } = useGettext()
const route = useRoute()

/** Current in-app path (`/planner/calendar`), '' when unknown. */
const currentPath = computed(() => (typeof route.value?.path === 'string' ? route.value.path : ''))

/** Ask the Settings page for this page's tab, then let the link navigate. */
function requestTab(): void {
  requestSettingsTab(settingsSectionForPath(currentPath.value))
}
</script>

<style scoped>
.page-header-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  color: var(--oc-role-on-surface-variant, #40484c);
  text-decoration: none;
}

.page-header-action:hover,
.page-header-action:focus-visible {
  background: var(--oc-role-surface-container, #eceef0);
  color: var(--oc-role-on-surface, #191c1d);
}

.page-header-action:focus-visible {
  outline: 2px solid var(--oc-role-primary, #00677f);
  outline-offset: 2px;
}
</style>
