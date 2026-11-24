<template>
  <Teleport to="body">
    <div v-if="move" class="modal-overlay" @click.self="emit('cancel')">
      <div
        ref="panelRef"
        class="modal-panel modal-panel--compact"
        role="dialog"
        aria-modal="true"
        aria-labelledby="move-dialog-title"
      >
        <h2 id="move-dialog-title" class="modal-title">{{ $gettext('Move event') }}</h2>
        <p class="move-event-name">{{ move.title }}</p>
        <div class="move-comparison">
          <div class="move-side">
            <span class="move-label">{{ $gettext('From') }}</span>
            <span class="move-date">{{ move.oldDate }}</span>
            <span v-if="move.oldTime" class="move-time">{{ move.oldTime }}</span>
          </div>
          <div class="move-arrow">
            <oc-icon name="arrow-right-s" size="large" />
          </div>
          <div class="move-side">
            <span class="move-label">{{ $gettext('To') }}</span>
            <span class="move-date">{{ move.newDate }}</span>
            <span v-if="move.newTime" class="move-time">{{ move.newTime }}</span>
          </div>
        </div>
        <div class="modal-actions">
          <div class="spacer" />
          <oc-button appearance="outline" :disabled="saving" @click="emit('cancel')">
            {{ $gettext('Cancel') }}
          </oc-button>
          <oc-button
            appearance="filled"
            color-role="primary"
            :disabled="saving"
            @click="emit('confirm')"
          >
            {{ $gettext('Move') }}
          </oc-button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * MoveConfirmDialog – asks the user to confirm a drag/resize of an event and
 * shows the old/new date side by side. Rendering only: the page owns the
 * pending move and performs the PUT on `confirm`.
 */
import { computed, ref } from 'vue'
import { useGettext } from 'vue3-gettext'

import { useModalA11y } from '../../composables/useModalA11y'
import type { EventMoveInfo } from '../../types'

const { $gettext } = useGettext()

const props = defineProps<{
  /** Pending move; the dialog is open while this is set. */
  move: EventMoveInfo | null
  saving?: boolean
}>()

const emit = defineEmits<{ cancel: []; confirm: [] }>()

const panelRef = ref<HTMLElement | null>(null)
const isOpen = computed(() => !!props.move)

useModalA11y(panelRef, isOpen, { onClose: () => emit('cancel') })
</script>

<style scoped>
.modal-title {
  font-size: 1.1rem;
  margin: 0;
}

.move-event-name {
  font-size: 1.1rem;
  font-weight: 600;
  margin: 0 0 16px;
  color: var(--oc-role-on-surface, #191c1d);
}

.move-comparison {
  display: inline-flex;
  align-items: center;
  gap: 16px;
  padding: 14px 20px;
  border-radius: 12px;
  background: var(--oc-role-surface-container-low, #f5f6f8);
}

.move-side {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  text-align: center;
}

.move-label {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--oc-role-on-surface-variant, #40484c);
  margin-bottom: 4px;
}

.move-date {
  font-size: 1rem;
  font-weight: 500;
  color: var(--oc-role-on-surface, #191c1d);
}

.move-time {
  font-size: 1rem;
  color: var(--oc-role-on-surface-variant, #40484c);
}

.move-arrow {
  flex-shrink: 0;
  color: var(--oc-role-on-surface-variant, #40484c);
  display: flex;
  align-items: center;
}

@media (max-width: 640px) {
  .move-comparison {
    gap: 8px;
    padding: 12px;
  }
}
</style>
