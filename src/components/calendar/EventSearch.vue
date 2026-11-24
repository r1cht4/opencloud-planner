<template>
  <div class="event-search">
    <button
      v-if="collapsible && !expanded"
      type="button"
      class="event-search-toggle"
      :aria-label="$gettext('Search events')"
      :title="$gettext('Search events')"
      @click="expand"
    >
      <oc-icon name="search" size="small" fill-type="line" />
    </button>

    <div v-else class="event-search-field">
      <oc-icon
        name="search"
        size="small"
        fill-type="line"
        class="event-search-icon"
        aria-hidden="true"
      />
      <input
        ref="inputRef"
        v-model="query"
        type="search"
        class="event-search-input"
        role="combobox"
        aria-autocomplete="list"
        :aria-label="$gettext('Search events')"
        :placeholder="$gettext('Search events')"
        :aria-expanded="open ? 'true' : 'false'"
        :aria-controls="listId"
        :aria-activedescendant="activeOptionId"
        @focus="open = query.trim().length > 0"
        @keydown="onKeydown"
        @blur="onBlur"
      />
      <button
        v-if="query"
        type="button"
        class="event-search-clear"
        :aria-label="$gettext('Clear search')"
        :title="$gettext('Clear search')"
        @click="clear"
      >
        <oc-icon name="close" size="small" />
      </button>
    </div>

    <div v-if="open" class="event-search-panel">
      <ul
        :id="listId"
        class="event-search-list"
        role="listbox"
        :aria-label="$gettext('Search results')"
      >
        <li
          v-for="(ev, idx) in results"
          :id="optionId(idx)"
          :key="ev.id"
          role="option"
          class="event-search-option"
          :class="{ 'event-search-option--active': idx === activeIndex }"
          :aria-selected="idx === activeIndex ? 'true' : 'false'"
          @mousedown.prevent="select(ev)"
          @mousemove="activeIndex = idx"
        >
          <span
            class="event-search-dot"
            :style="{ backgroundColor: colorFor(ev) }"
            aria-hidden="true"
          />
          <span class="event-search-when">
            {{ labelsFor(ev).date
            }}<template v-if="labelsFor(ev).time">, {{ labelsFor(ev).time }}</template>
          </span>
          <span class="event-search-title">{{ ev.title }}</span>
        </li>
      </ul>
      <p v-if="results.length === 0" class="event-search-empty" role="status">
        {{ $gettext('No matching events in the loaded period.') }}
      </p>
      <p class="event-search-note">
        {{ $gettext('Search covers the loaded period (view ±6 months).') }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * EventSearch – search box for the calendar header.
 *
 * Searches the events already loaded in memory (`eventSearch.ts` does the
 * matching) and hands the picked event to the page, which navigates the grid to
 * its date and opens the preview. Collapses to an icon button on narrow
 * screens; the dropdown is a `listbox` driven by ArrowUp/Down, Enter and Escape
 * with `aria-activedescendant` on the combobox input.
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useGettext } from 'vue3-gettext'
import { useFormatLocale } from '../../settings/formatLocale'

import {
  searchEvents,
  searchResultLabels,
  type SearchResultLabels
} from '../../composables/eventSearch'
import { getCalendarColor } from '../../composables/calendarViewUtils'
import type { CalendarCollection, CalendarEvent } from '../../types'

const { $gettext } = useGettext()
const formatLocale = useFormatLocale()

const props = defineProps<{
  /** Events held in memory, already filtered to visible calendars. */
  events: CalendarEvent[]
  calendars: CalendarCollection[]
}>()

const emit = defineEmits<{
  select: [event: CalendarEvent]
}>()

const query = ref('')
const open = ref(false)
const activeIndex = ref(-1)
const inputRef = ref<HTMLInputElement | null>(null)
const listId = 'event-search-results'

const narrowMq =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(max-width: 640px)')
    : null
const collapsible = ref(narrowMq?.matches ?? false)
const expanded = ref(!collapsible.value)

const results = computed(() => searchEvents(props.events, query.value))

const activeOptionId = computed(() =>
  open.value && activeIndex.value >= 0 && activeIndex.value < results.value.length
    ? optionId(activeIndex.value)
    : undefined
)

function optionId(idx: number): string {
  return `${listId}-option-${idx}`
}

function colorFor(event: CalendarEvent): string {
  return getCalendarColor(props.calendars, event.calendarId)
}

function labelsFor(event: CalendarEvent): SearchResultLabels {
  return searchResultLabels(event, formatLocale.value)
}

// A new query starts from the first result; closing the dropdown forgets the
// highlighted row so the next search does not jump to a stale index.
watch(query, () => {
  activeIndex.value = -1
  open.value = query.value.trim().length > 0
})

watch(results, (list) => {
  if (activeIndex.value >= list.length) activeIndex.value = list.length - 1
})

function onKeydown(e: KeyboardEvent) {
  const list = results.value
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (!open.value) {
      open.value = query.value.trim().length > 0
      activeIndex.value = 0
      return
    }
    if (list.length === 0) return
    activeIndex.value = (activeIndex.value + 1) % list.length
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (!open.value || list.length === 0) return
    activeIndex.value = activeIndex.value <= 0 ? list.length - 1 : activeIndex.value - 1
  } else if (e.key === 'Enter') {
    const picked = list[activeIndex.value] ?? list[0]
    if (!picked) return
    e.preventDefault()
    select(picked)
  } else if (e.key === 'Escape') {
    e.preventDefault()
    // First Escape closes the dropdown, a second one clears the input.
    if (open.value) {
      open.value = false
      activeIndex.value = -1
    } else {
      query.value = ''
    }
  }
}

function onBlur() {
  open.value = false
  activeIndex.value = -1
}

function select(event: CalendarEvent) {
  emit('select', event)
  open.value = false
  activeIndex.value = -1
}

function clear() {
  query.value = ''
  open.value = false
  activeIndex.value = -1
  inputRef.value?.focus()
}

async function expand() {
  expanded.value = true
  // The input is only rendered after this tick; focus it so typing just works.
  await nextTick()
  inputRef.value?.focus()
}

function onMediaChange(e: MediaQueryListEvent) {
  collapsible.value = e.matches
  if (!e.matches) expanded.value = true
  else if (!query.value) expanded.value = false
}

onMounted(() => narrowMq?.addEventListener('change', onMediaChange))
onUnmounted(() => narrowMq?.removeEventListener('change', onMediaChange))
</script>

<style scoped>
.event-search {
  position: relative;
  display: flex;
  align-items: center;
}

.event-search-toggle,
.event-search-clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 33px;
  height: 33px;
  padding: 0;
  border: 1px solid var(--oc-role-outline-variant, #bfc8cc);
  border-radius: 8px;
  background: var(--oc-role-surface, #fbfcfe);
  color: var(--oc-role-on-surface-variant, #40484c);
  cursor: pointer;
}
.event-search-clear {
  border: 0;
  background: transparent;
  width: 28px;
  height: 28px;
}
.event-search-toggle:hover,
.event-search-toggle:focus-visible,
.event-search-clear:hover,
.event-search-clear:focus-visible {
  border-color: var(--oc-role-secondary, #20434f);
  color: var(--oc-role-secondary, #20434f);
  outline: none;
}

.event-search-field {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 33px;
  padding-inline: 8px 4px;
  border: 1px solid var(--oc-role-outline-variant, #bfc8cc);
  border-radius: 8px;
  background: var(--oc-role-surface, #fbfcfe);
  min-width: 0;
}
.event-search-field:focus-within {
  border-color: var(--oc-role-secondary, #20434f);
}

.event-search-icon {
  color: var(--oc-role-on-surface-variant, #40484c);
  flex-shrink: 0;
  /* The icon's own box: the outline magnifier (`fill-type="line"`) at a fixed
     16 px, so a tight flex row can never squeeze it into a dot. */
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
}
.event-search-icon :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
  fill: currentColor;
}

.event-search-input {
  border: 0;
  outline: none;
  background: transparent;
  color: var(--oc-role-on-surface, #191c1d);
  font-size: 0.85rem;
  width: 160px;
  min-width: 0;
}
/* Keep the browser's native clear button out of the way — we render our own. */
.event-search-input::-webkit-search-cancel-button {
  display: none;
}

.event-search-panel {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 20;
  width: min(22rem, 90vw);
  padding: 6px;
  border: 1px solid var(--oc-role-outline-variant, #bfc8cc);
  border-radius: 8px;
  background: var(--oc-role-surface, #fbfcfe);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.16);
}

.event-search-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 18rem;
  overflow-y: auto;
}

.event-search-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 6px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.85rem;
}
.event-search-option--active {
  background: var(--oc-role-surface-container-highest, #e6e8ea);
}

.event-search-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.event-search-when {
  flex-shrink: 0;
  color: var(--oc-role-on-surface-variant, #40484c);
  font-variant-numeric: tabular-nums;
}

.event-search-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.event-search-empty,
.event-search-note {
  margin: 4px 6px;
  font-size: 0.75rem;
  color: var(--oc-role-on-surface-variant, #40484c);
}

.event-search-note {
  opacity: 0.8;
}
</style>
