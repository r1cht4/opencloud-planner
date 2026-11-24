<template>
  <Teleport to="body">
    <div
      class="stack-popover"
      :style="{ left: `${x}px`, top: `${y}px` }"
      @mouseenter="emit('hoverStart')"
      @mouseleave="emit('hoverEnd')"
    >
      <button
        v-for="ev in events"
        :key="ev.id"
        type="button"
        class="stack-popover-item"
        @click="emit('select', ev)"
      >
        <span class="stack-popover-time">{{ formatItemTime(ev) }}</span>
        <span class="stack-popover-title">{{ ev.title }}</span>
      </button>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * StackPopover – floating list of the events hidden behind a collapsed
 * "+N" cluster in the calendar grid. Positioned in viewport coordinates by the
 * page; hovering it must keep it open, so enter/leave are forwarded to the page
 * that owns the close timer.
 */
import { useGettext } from 'vue3-gettext'

import type { CalendarEvent } from '../../types'

const { $gettext } = useGettext()

defineProps<{
  events: CalendarEvent[]
  x: number
  y: number
}>()

const emit = defineEmits<{
  select: [event: CalendarEvent]
  hoverStart: []
  hoverEnd: []
}>()

function formatItemTime(e: CalendarEvent): string {
  if (e.isAllDay ?? !e.start.includes(' ')) return $gettext('All day')
  const tf = (s: string) => s.split(' ')[1] || ''
  return `${tf(e.start)} – ${tf(e.end)}`
}
</script>

<style scoped>
.stack-popover {
  position: fixed;
  z-index: 200;
  width: 280px;
  max-height: 320px;
  overflow-y: auto;
  padding: 6px;
  border-radius: 12px;
  border: 1px solid var(--oc-role-outline-variant, #bfc8cc);
  background: var(--oc-role-surface-container-lowest, #ffffff);
  color: var(--oc-role-on-surface, #191c1d);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
}

.stack-popover-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  text-align: start;
  cursor: pointer;
}
.stack-popover-item:hover,
.stack-popover-item:focus-visible {
  background: var(--oc-role-surface-container-low, #f5f6f8);
  outline: none;
}

.stack-popover-time {
  font-size: 0.72rem;
  color: var(--oc-role-on-surface-variant, #40484c);
}

.stack-popover-title {
  font-size: 0.85rem;
  font-weight: 600;
}
</style>
