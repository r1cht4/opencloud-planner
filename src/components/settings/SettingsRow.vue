<template>
  <div class="settings-row">
    <div class="settings-row-text">
      <div class="settings-row-heading">
        <label v-if="labelFor" class="settings-row-label" :for="labelFor">
          {{ label }}
          <SettingsLock v-if="locked" />
        </label>
        <span v-else class="settings-row-label">
          {{ label }}
          <SettingsLock v-if="locked" />
        </span>
        <!-- Compact controls that belong to the label (an app row's move
             buttons): they sit next to the label, not in the control column, so
             the selects and checkboxes of all rows stay aligned. -->
        <slot name="label-actions" />
      </div>
      <span v-if="hint" class="settings-row-hint">{{ hint }}</span>
    </div>
    <div class="settings-row-control">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * One setting: label (plus optional one-line hint) on the left, control on the
 * right — the single layout every tab uses, instead of per-feature CSS.
 *
 * `labelFor` ties a checkbox control to the label text (`<label for>`); a locked
 * row renders the small lock marker next to the label, so no section needs the
 * repeated "read-only" paragraph anymore.
 */
import SettingsLock from './SettingsLock.vue'

defineOptions({ name: 'SettingsRow' })

defineProps<{
  /** Visible label. */
  label: string
  /** Optional one-line explanation under the label. */
  hint?: string
  /** Admin-locked: the control is disabled and the label gets the lock marker. */
  locked?: boolean
  /** `id` of the control, so clicking the label focuses/toggles it. */
  labelFor?: string
}>()
</script>

<style scoped>
.settings-row {
  display: grid;
  grid-template-columns: 1fr minmax(180px, 280px);
  align-items: center;
  gap: 2px 16px;
  padding: 12px 0;
  border-bottom: 1px solid var(--oc-role-outline-variant, #bfc8cc);
  min-width: 0;
}

.settings-row:first-child {
  padding-top: 0;
}

.settings-row:last-child {
  padding-bottom: 0;
  border-bottom: 0;
}

.settings-row-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.settings-row-label {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--oc-role-on-surface, #191c1d);
}

/* The label and its inline actions on one line, independent of the control
   column: the app rows' move buttons never push the select/checkbox edges. */
.settings-row-heading {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.settings-row-hint {
  font-size: 0.8125rem;
  line-height: 1.35;
  color: var(--oc-role-on-surface-variant, #40484c);
}

.settings-row-control {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}

/* The control owns the whole column: a select is as wide as the column allows,
   checkboxes stay touchable. */
.settings-row-control :deep(select),
.settings-row-control :deep(input[type='time']),
.settings-row-control :deep(input[type='text']) {
  width: 100%;
  max-width: 100%;
}

.settings-row-control :deep(input[type='checkbox']) {
  width: 1.125rem;
  height: 1.125rem;
  /* The UA margin (3px) would keep the right-aligned box off the card edge. */
  margin: 0;
  accent-color: var(--oc-role-secondary, #20434f);
}

/* A checkbox is a compact control: right-align it (with its toggle row) so it sits
   at the edge of the card instead of starting somewhere inside the control column.
   Rows that mix a checkbox with a select keep the stretched layout. */
.settings-row-control:has(input[type='checkbox']):not(:has(select)) {
  justify-self: end;
}

@media (max-width: 600px) {
  .settings-row {
    grid-template-columns: minmax(0, 1fr);
    gap: 6px;
    padding: 10px 0;
  }

  /* Label above control, control full width, touchable height. */
  .settings-row-control {
    min-height: 40px;
  }
}
</style>
