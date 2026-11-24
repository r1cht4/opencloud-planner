<template>
  <details
    v-if="collapsible"
    :id="id"
    class="settings-section settings-section--collapsible"
    :class="{ 'settings-section--wide': wide }"
  >
    <summary class="settings-section-summary">
      <h2 class="settings-section-title">{{ title }}</h2>
      <span class="settings-section-chevron" aria-hidden="true">
        <oc-icon name="arrow-down-s" size="small" />
      </span>
    </summary>
    <p v-if="hint" class="settings-section-hint">{{ hint }}</p>
    <div class="settings-section-body">
      <slot />
    </div>
  </details>

  <section
    v-else
    :id="id"
    class="settings-section"
    :class="{ 'settings-section--wide': wide }"
    :aria-labelledby="id ? `${id}-title` : undefined"
  >
    <h2 :id="id ? `${id}-title` : undefined" class="settings-section-title">{{ title }}</h2>
    <p v-if="hint" class="settings-section-hint">{{ hint }}</p>
    <div class="settings-section-body">
      <slot />
    </div>
  </section>
</template>

<script setup lang="ts">
/**
 * One group card of a Settings tab (`Apps`, `View & time`, `Import & export`, …).
 *
 * The card is the layout primitive of the redesign: heading, optional one-line
 * hint and the rows/blocks of the group. In the tab's grid it is one column;
 * `wide` makes it span both. `collapsible` renders the card as a `<details>` for
 * a whole group that is rarely used (Data → Clean up).
 */
defineOptions({ name: 'SettingsSection' })

defineProps<{
  /** Visible group heading. */
  title: string
  /** Optional one-line explanation under the heading. */
  hint?: string
  /** Anchor id (also used for the heading id); optional for plain groups. */
  id?: string
  /** Span both grid columns (devices, bulk import/export, collections). */
  wide?: boolean
  /** Render as a `<details>` that is collapsed by default. */
  collapsible?: boolean
}>()
</script>

<style scoped>
.settings-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
  padding: 16px;
  border-radius: 8px;
  background: var(--oc-role-surface-container-low, #f3f4f5);
}

.settings-section--wide {
  grid-column: 1 / -1;
}

.settings-section-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--oc-role-on-surface, #191c1d);
}

.settings-section-hint {
  margin: 0;
  font-size: 0.8125rem;
  line-height: 1.35;
  color: var(--oc-role-on-surface-variant, #40484c);
}

.settings-section-body {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

/* Collapsible group (Data → Clean up): the summary is the heading, the chevron
   replaces the default disclosure marker. */
.settings-section-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  list-style: none;
  cursor: pointer;
}

.settings-section-summary::-webkit-details-marker {
  display: none;
}

.settings-section-summary:focus-visible {
  outline: 2px solid var(--oc-role-primary, #00677f);
  outline-offset: 2px;
  border-radius: 4px;
}

.settings-section-chevron {
  display: inline-flex;
  color: var(--oc-role-on-surface-variant, #40484c);
  transition: transform 0.15s ease;
}

.settings-section--collapsible[open] .settings-section-chevron {
  transform: rotate(180deg);
}
</style>
