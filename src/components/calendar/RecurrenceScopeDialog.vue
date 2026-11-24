<template>
  <Teleport to="body">
    <div v-if="mode" class="modal-overlay" @click.self="emit('cancel')">
      <div
        ref="panelRef"
        class="modal-panel modal-panel--compact"
        role="dialog"
        aria-modal="true"
        aria-labelledby="recurrence-dialog-title"
      >
        <h2 id="recurrence-dialog-title" class="modal-title">
          {{
            mode === 'delete'
              ? $gettext('Delete recurring event')
              : mode === 'move'
                ? $gettext('Move recurring event')
                : $gettext('Update recurring event')
          }}
        </h2>
        <p class="recurrence-choice-text">
          {{
            mode === 'delete'
              ? $gettext('Do you want to delete only this event or the entire series?')
              : mode === 'move'
                ? $gettext('Do you want to move only this event or the entire series?')
                : $gettext('Do you want to update only this event or the entire series?')
          }}
        </p>
        <div class="modal-actions">
          <oc-button appearance="outline" @click="emit('select', 'single')">
            {{ $gettext('Only this event') }}
          </oc-button>
          <div class="spacer" />
          <oc-button appearance="outline" @click="emit('cancel')">
            {{ $gettext('Cancel') }}
          </oc-button>
          <oc-button appearance="filled" @click="emit('select', 'series')">
            {{ $gettext('Entire series') }}
          </oc-button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * RecurrenceScopeDialog – "only this event" vs. "entire series" choice for
 * recurring events. Open while `mode` is set; `cancel` resolves as "no choice".
 */
import { computed, ref } from 'vue'
import { useGettext } from 'vue3-gettext'

import { useModalA11y } from '../../composables/useModalA11y'
import type { RecurrenceScope } from '../../types'

const { $gettext } = useGettext()

const props = defineProps<{ mode: 'save' | 'delete' | 'move' | null }>()

const emit = defineEmits<{ select: [scope: RecurrenceScope]; cancel: [] }>()

const panelRef = ref<HTMLElement | null>(null)
const isOpen = computed(() => !!props.mode)

useModalA11y(panelRef, isOpen, { onClose: () => emit('cancel') })
</script>

<style scoped>
.modal-title {
  font-size: 1.1rem;
  margin: 0;
}

.recurrence-choice-text {
  color: var(--oc-role-on-surface-variant, #40484c);
  font-size: 0.9rem;
  margin-bottom: 16px;
}
</style>
