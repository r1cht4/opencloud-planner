<template>
  <div class="settings-tabs">
    <div class="settings-tablist" role="tablist" :aria-label="$gettext('Settings sections')">
      <button
        v-for="(section, index) in sections"
        :id="tabId(section.id)"
        :key="section.id"
        ref="tabElements"
        type="button"
        role="tab"
        class="settings-tab"
        :class="{ 'settings-tab--active': section.id === modelValue }"
        :aria-selected="section.id === modelValue ? 'true' : 'false'"
        :aria-controls="panelId(section.id)"
        :tabindex="section.id === modelValue ? 0 : -1"
        :data-section="section.id"
        @click="select(section.id)"
        @keydown="onKeydown($event, index)"
      >
        {{ section.label }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * The Settings tab bar — one tab per section, only the active one is rendered
 * (see `views/Settings.vue`).
 *
 * Two things here are not cosmetic:
 *
 * - **Sticky.** The bar is `position: sticky; top: 0` with an opaque background,
 *   so it stays visible while the sections scroll. The Settings page itself is
 *   the scrolling element (`height: 100%` inside the host's content area, like
 *   every app view), and it must not add `overflow` between this bar and that
 *   scroller — an ancestor with `overflow: hidden/auto` silently kills sticky.
 * - **Keyboard.** `role="tablist"` promises arrow-key navigation; the inactive
 *   tabs are `tabindex="-1"`, so Tab enters the bar once and the arrows (plus
 *   Home/End) move through it. Selecting follows focus (automatic activation),
 *   which is what a settings tab bar should do.
 */
import { ref } from 'vue'
import { useGettext } from 'vue3-gettext'
import type { SettingsSectionId } from '../../navigation'

defineOptions({ name: 'SettingsTabs' })

const props = defineProps<{
  /** Currently open section id. */
  modelValue: SettingsSectionId
  /** Tabs in display order; `id` is the deep-link hash (`#tools`). */
  sections: ReadonlyArray<{ id: SettingsSectionId; label: string }>
}>()

const emit = defineEmits<{ 'update:modelValue': [id: SettingsSectionId] }>()

const { $gettext } = useGettext()

/** Tab element of every section, in the order of `sections` (keyboard focus). */
const tabElements = ref<HTMLButtonElement[]>([])

function tabId(id: SettingsSectionId): string {
  return `settings-tab-${id}`
}

function panelId(id: SettingsSectionId): string {
  return `settings-panel-${id}`
}

function select(id: SettingsSectionId): void {
  if (id !== props.modelValue) emit('update:modelValue', id)
}

/**
 * Arrow keys wrap around (a tab bar is a ring), Home/End jump to the ends.
 * Focus is moved explicitly because a `tabindex="-1"` button is not reachable.
 */
function onKeydown(event: KeyboardEvent, index: number): void {
  const last = props.sections.length - 1
  let next: number
  switch (event.key) {
    case 'ArrowRight':
    case 'ArrowDown':
      next = index === last ? 0 : index + 1
      break
    case 'ArrowLeft':
    case 'ArrowUp':
      next = index === 0 ? last : index - 1
      break
    case 'Home':
      next = 0
      break
    case 'End':
      next = last
      break
    default:
      return
  }

  const target = props.sections[next]
  if (!target) return
  event.preventDefault()
  select(target.id)
  tabElements.value[next]?.focus()
}
</script>

<style scoped>
/* The scroll container and the sticky bar are the same element on purpose: a
   sticky child of a scroll container that scrolls horizontally would stick to
   that container instead of the page. */
.settings-tabs {
  /* The Settings page is a column flex container with a definite height. A flex
     item whose `overflow` is not `visible` may shrink to zero (that is how the
     tabs once vanished — the bar was 1px tall and clipped its own buttons), so
     the bar keeps its natural height no matter what the parent does. */
  flex: none;
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  /* Mobile: the tabs scroll sideways instead of forcing the page to scroll. */
  overflow-x: auto;
  overflow-y: hidden;
  background: var(--oc-role-surface, #fbfcfe);
  border-bottom: 1px solid var(--oc-role-outline-variant, #bfc8cc);
  scrollbar-width: thin;
}

/* Same content column as the cards below, so the tabs line up with them. */
.settings-tablist {
  display: flex;
  gap: 4px;
  width: 100%;
  max-width: var(--settings-column, 1100px);
  margin: 0 auto;
  box-sizing: border-box;
  padding: 0 var(--settings-gutter, 16px);
}

.settings-tab {
  flex: 0 0 auto;
  appearance: none;
  background: none;
  border: 0;
  border-bottom: 2px solid transparent;
  margin: 0;
  padding: 10px 12px;
  font: inherit;
  font-size: 0.875rem;
  white-space: nowrap;
  color: var(--oc-role-on-surface-variant, #40484c);
  cursor: pointer;
}

.settings-tab:hover {
  color: var(--oc-role-on-surface, #191c1d);
}

.settings-tab:focus-visible {
  /* Inset: the bar clips its overflow, an outside ring would be cut off. */
  outline: 2px solid var(--oc-role-secondary, #20434f);
  outline-offset: -2px;
  border-radius: 4px 4px 0 0;
}

.settings-tab--active {
  color: var(--oc-role-secondary, #20434f);
  border-bottom-color: var(--oc-role-secondary, #20434f);
  font-weight: 600;
}

@media (max-width: 600px) {
  .settings-tab {
    padding: 10px;
  }
}
</style>
