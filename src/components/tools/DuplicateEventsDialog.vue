<!--
  DuplicateEventsDialog – confirmation + execution for event duplicate cleanup.

  Self-contained dialog (own overlay, `role="dialog"`, focus trap via
  `useModalA11y`), opened by `DuplicateEventsCard.vue`.

    props:
      groups: DuplicateGroup[]   groups from `findDuplicateEvents` (keep + remove)
      calendarName?: string      display name of the calendar, used in the text

    emits:
      close                      the host removes the dialog
      deleted {deleted, failed}  cleanup finished (counts for the toast/host)

  Deleting uses the calendar service's `deleteEvent`, which sends `If-Match` with
  the stored ETag — a copy that changed elsewhere since the search fails with a
  412 instead of being deleted blindly, and is counted as failed.
-->
<template>
  <Teleport to="body">
    <div class="modal-overlay" @click.self="close">
      <div
        ref="panelRef"
        class="modal-panel duplicate-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="duplicate-events-title"
      >
        <h2 id="duplicate-events-title" class="modal-title">
          {{ $gettext('Remove duplicate events') }}
        </h2>

        <p class="card-hint">
          {{
            $ngettext(
              '%{count} duplicate group in "%{calendar}". The event with the most details is kept.',
              '%{count} duplicate groups in "%{calendar}". The event with the most details is kept.',
              groups.length,
              { count: groups.length, calendar: calendarName }
            )
          }}
        </p>

        <ul class="group-list">
          <li v-for="group in groups" :key="group.keep.id" class="group-row">
            <div class="group-keep">
              <span class="group-title">{{ group.keep.title }}</span>
              <span class="group-detail">{{ group.keep.start }} · {{ $gettext('kept') }}</span>
            </div>
            <ul class="remove-list">
              <li v-for="event in group.remove" :key="event.id" class="remove-row">
                <span class="group-detail"
                  >{{ event.start }} · {{ $gettext('will be deleted') }}</span
                >
              </li>
            </ul>
          </li>
        </ul>

        <p v-if="busy" class="card-hint" role="status">{{ $gettext('Deleting…') }}</p>

        <div class="modal-actions">
          <div class="spacer" />
          <oc-button appearance="outline" :disabled="busy" @click="close">
            {{ $gettext('Cancel') }}
          </oc-button>
          <oc-button
            appearance="filled"
            color-role="primary"
            :disabled="busy || !removableCount"
            @click="confirmDelete"
          >
            {{ $gettext('Delete duplicates') }}
          </oc-button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useGettext } from 'vue3-gettext'
import { useModalA11y } from '../../composables/useModalA11y'
import { useCalendarService } from '../../composables/useCalendarService'
import type { DuplicateGroup } from '../../tools/eventDuplicates'
import '../../styles/modal.css'

defineOptions({ name: 'DuplicateEventsDialog' })

const props = withDefaults(
  defineProps<{
    groups: DuplicateGroup[]
    calendarName?: string
  }>(),
  { calendarName: '' }
)

const emit = defineEmits<{
  close: []
  deleted: [counts: { deleted: number; failed: number }]
}>()

const { $gettext, $ngettext } = useGettext()
const { deleteEvent } = useCalendarService()

const panelRef = ref<HTMLElement | null>(null)
const busy = ref(false)
const isOpen = ref(false)
useModalA11y(panelRef, isOpen, { onClose: close })
onMounted(() => {
  isOpen.value = true
})

const removableCount = computed(() =>
  props.groups.reduce((total, group) => total + group.remove.length, 0)
)

function close() {
  if (busy.value) return
  emit('close')
}

async function confirmDelete() {
  if (busy.value || !removableCount.value) return
  busy.value = true
  let deleted = 0
  let failed = 0

  try {
    for (const group of props.groups) {
      for (const event of group.remove) {
        // ETag-safe: the service sends If-Match and turns a 412 into `false`.
        const ok = await deleteEvent(event)
        if (ok) deleted++
        else failed++
      }
    }
    emit('deleted', { deleted, failed })
    emit('close')
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.duplicate-panel {
  width: 520px;
}

.card-hint {
  margin: 0 0 8px;
  font-size: 0.8125rem;
  color: var(--oc-role-on-surface-variant, #40484c);
}

.group-list,
.remove-list {
  list-style: none;
  margin: 8px 0;
  padding: 0;
}

.group-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 260px;
  overflow-y: auto;
}

.group-row {
  padding: 6px 0;
  border-bottom: 1px solid var(--oc-role-outline-variant, #bfc8cc);
}
.group-row:last-child {
  border-bottom: none;
}

.group-keep {
  display: flex;
  flex-direction: column;
}

.group-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--oc-role-on-surface, #191c1d);
}

.group-detail {
  font-size: 0.75rem;
  color: var(--oc-role-on-surface-variant, #40484c);
}

.remove-row {
  padding-left: 12px;
}

.modal-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--oc-role-outline-variant, #bfc8cc);
}

.spacer {
  flex: 1;
}
</style>
