<template>
  <div v-if="outcome === 'pending'" class="gate-pending" role="status" aria-live="polite">
    <oc-spinner size="medium" />
    <p class="gate-text">{{ $gettext('Checking the calendar server…') }}</p>
  </div>

  <SetupState v-else-if="failure" :outcome="failure" />

  <slot v-else />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useGettext } from 'vue3-gettext'
import { useConnectionProbe, type ProbeOutcome } from '../composables/useConnectionProbe'
import SetupState from './SetupState.vue'

/**
 * ConnectionGate – shows the setup state instead of the app content while the DAV
 * backend is not usable.
 *
 * Usage in a view (one line around the existing content):
 *
 * ```vue
 * <template>
 *   <main class="calendar-page">
 *     <ConnectionGate>
 *       … the view as it is today …
 *     </ConnectionGate>
 *   </main>
 * </template>
 *
 * <script setup lang="ts">
 * import ConnectionGate from '../components/ConnectionGate.vue'
 * ```
 *
 * The probe itself is started once for the whole app in `src/index.ts`
 * (`startConnectionProbe()`); the gate only reads the shared outcome, so wrapping
 * four views costs four imports and four tags — no extra requests.
 */

defineOptions({ name: 'ConnectionGate' })

const { $gettext } = useGettext()
const { outcome } = useConnectionProbe()

/** The non-ok outcome, or `null` while pending/ok (keeps the prop type narrow). */
const failure = computed<ProbeOutcome | null>(() =>
  outcome.value === 'ok' || outcome.value === 'pending' ? null : outcome.value
)
</script>

<style scoped>
.gate-pending {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  min-height: 12rem;
  padding: 24px;
}

.gate-text {
  margin: 0;
  font-size: 0.875rem;
  color: var(--oc-role-on-surface-variant, #40484c);
}
</style>
