<template>
  <span
    class="settings-lock"
    role="img"
    :title="$gettext('Set by your administrator.')"
    :aria-label="$gettext('Set by your administrator.')"
  >
    <oc-icon name="lock" size="small" />
  </span>
</template>

<script setup lang="ts">
/**
 * The lock marker of an admin-locked setting.
 *
 * One shared component instead of a repeated "Settings marked as read-only are
 * set by your administrator." paragraph in every section: the disabled control
 * plus this icon next to its label says the same thing, and the tooltip /
 * accessible name carries the sentence for the exact row.
 */
import { useGettext } from 'vue3-gettext'

defineOptions({ name: 'SettingsLock' })

const { $gettext } = useGettext()
</script>

<style scoped>
.settings-lock {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  color: var(--oc-role-on-surface-variant, #40484c);
}
</style>
