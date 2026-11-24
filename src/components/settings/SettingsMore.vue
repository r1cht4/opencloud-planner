<template>
  <details class="settings-more">
    <summary class="settings-more-summary">
      <span class="settings-more-chevron" aria-hidden="true">
        <oc-icon name="arrow-down-s" size="small" />
      </span>
      <span>{{ label || $gettext('More options') }}</span>
    </summary>
    <div class="settings-more-body">
      <slot />
    </div>
  </details>
</template>

<script setup lang="ts">
/**
 * "More options" — the collapsed tail of a settings group.
 *
 * A native `<details>` (no JS state, no ARIA to maintain): closed by default,
 * styled as a small text button with a chevron that turns while open. Rarely
 * changed controls live in here so a tab stays short.
 */
import { useGettext } from 'vue3-gettext'

defineOptions({ name: 'SettingsMore' })

defineProps<{
  /** Summary text; defaults to "More options". */
  label?: string
}>()

const { $gettext } = useGettext()
</script>

<style scoped>
.settings-more {
  border-top: 1px solid var(--oc-role-outline-variant, #bfc8cc);
  padding-top: 8px;
}

.settings-more-summary {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  list-style: none;
  cursor: pointer;
  font-size: 0.8125rem;
  /* Normal weight: it is a disclosure, not a heading. */
  font-weight: 400;
  /* `--oc-role-primary` is a pale accent in the OpenCloud light theme (#e2baff) —
     as text on the near-white card it is unreadable. The theme's dark accent
     (`secondary`, #20434f here) keeps the "text button" look and passes contrast,
     and the chevron inherits it. */
  color: var(--oc-role-secondary, #00677f);
  padding: 4px 0;
}

.settings-more-summary:hover {
  text-decoration: underline;
}

.settings-more-summary::-webkit-details-marker {
  display: none;
}

.settings-more-summary:focus-visible {
  outline: 2px solid var(--oc-role-primary, #00677f);
  outline-offset: 2px;
  border-radius: 4px;
}

.settings-more-chevron {
  display: inline-flex;
  transition: transform 0.15s ease;
}

.settings-more[open] .settings-more-chevron {
  transform: rotate(180deg);
}

.settings-more-body {
  padding-top: 8px;
  display: flex;
  flex-direction: column;
}
</style>
