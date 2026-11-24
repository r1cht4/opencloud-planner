<template>
  <div class="scroll-time">
    <input
      class="scroll-time-input"
      role="spinbutton"
      :aria-valuenow="hour"
      aria-valuemin="0"
      aria-valuemax="23"
      :aria-label="$gettext('Hours')"
      :value="hourStr"
      maxlength="2"
      inputmode="numeric"
      :disabled="disabled"
      @wheel.prevent="onWheelHour"
      @keydown="onKeyHour"
      @change="onInputHour"
      @focus="selectAll"
      @click="selectAll"
    />
    <span class="scroll-time-sep">:</span>
    <input
      class="scroll-time-input"
      role="spinbutton"
      :aria-valuenow="minute"
      aria-valuemin="0"
      aria-valuemax="59"
      :aria-label="$gettext('Minutes')"
      :value="minStr"
      maxlength="2"
      inputmode="numeric"
      :disabled="disabled"
      @wheel.prevent="onWheelMinute"
      @keydown="onKeyMinute"
      @change="onInputMinute"
      @focus="selectAll"
      @click="selectAll"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useGettext } from 'vue3-gettext'

/** One click/focus selects the whole two-digit field so typing replaces it. */
function selectAll(event: Event): void {
  ;(event.target as HTMLInputElement).select()
}

const { $gettext } = useGettext()

const props = defineProps<{ modelValue: string; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: string]; dayOffset: [offset: number] }>()
const disabled = computed(() => props.disabled ?? false)

const hour = computed(() => parseInt(props.modelValue.split(':')[0] || '0', 10))
const minute = computed(() => parseInt(props.modelValue.split(':')[1] || '0', 10))
const hourStr = computed(() => String(hour.value).padStart(2, '0'))
const minStr = computed(() => String(minute.value).padStart(2, '0'))

function emitTime(h: number, m: number) {
  let dayOff = 0
  if (h >= 24) {
    h -= 24
    dayOff = 1
  }
  if (h < 0) {
    h += 24
    dayOff = -1
  }
  emit('update:modelValue', `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
  if (dayOff) emit('dayOffset', dayOff)
}

function onWheelHour(e: WheelEvent) {
  if (disabled.value) return
  emitTime(hour.value + (e.deltaY < 0 ? 1 : -1), minute.value)
}

function onWheelMinute(e: WheelEvent) {
  if (disabled.value) return
  const dir = e.deltaY < 0 ? 1 : -1
  let m = minute.value + dir * 15
  let h = hour.value
  if (m >= 60) {
    m -= 60
    h++
  }
  if (m < 0) {
    m += 60
    h--
  }
  emitTime(h, m)
}

function onKeyHour(e: KeyboardEvent) {
  if (disabled.value) return
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    emitTime(hour.value + 1, minute.value)
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    emitTime(hour.value - 1, minute.value)
  }
}

function onKeyMinute(e: KeyboardEvent) {
  if (disabled.value) return
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    let m = minute.value + 15,
      h = hour.value
    if (m >= 60) {
      m -= 60
      h++
    }
    emitTime(h, m)
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    let m = minute.value - 15,
      h = hour.value
    if (m < 0) {
      m += 60
      h--
    }
    emitTime(h, m)
  }
}

function onInputHour(e: Event) {
  if (disabled.value) return
  const v = parseInt((e.target as HTMLInputElement).value, 10)
  if (!isNaN(v)) emitTime(Math.min(Math.max(v, 0), 23), minute.value)
  else (e.target as HTMLInputElement).value = hourStr.value
}

function onInputMinute(e: Event) {
  if (disabled.value) return
  const v = parseInt((e.target as HTMLInputElement).value, 10)
  if (!isNaN(v)) emitTime(hour.value, Math.min(Math.max(v, 0), 59))
  else (e.target as HTMLInputElement).value = minStr.value
}
</script>

<style scoped>
.scroll-time {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--oc-role-outline-variant, #bfc8cc);
  border-radius: 4px;
  background: var(--oc-role-surface, #fbfcfe);
  color: var(--oc-role-on-surface, #191c1d);
  font-variant-numeric: tabular-nums;
  box-sizing: border-box;
  height: 36px;
  padding: 0 8px;
  flex-shrink: 0;
}

.scroll-time-input {
  width: 2.5ch;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 0.9rem;
  text-align: center;
  padding: 2px 2px;
  border-radius: 4px;
  cursor: ns-resize;
  outline: none;
}

.scroll-time-input:not(:disabled):hover {
  background: var(--oc-role-secondary-container, #d5e4ea);
}

.scroll-time-input:focus {
  background: transparent;
  cursor: text;
}

.scroll-time-input:disabled {
  cursor: default;
  opacity: 0.7;
}

.scroll-time-sep {
  pointer-events: none;
  font-size: 0.9rem;
}
</style>
