<template>
  <Teleport to="body" :disabled="!standalone">
    <div :class="standalone ? 'import-overlay' : 'import-embed'" @click.self="onOverlayClick">
      <div
        ref="panelRef"
        class="import-panel"
        :class="{ 'import-panel--embedded': !standalone }"
        :role="standalone ? 'dialog' : undefined"
        :aria-modal="standalone ? 'true' : undefined"
        :aria-labelledby="standalone ? 'import-dialog-title' : undefined"
      >
        <h2 v-if="standalone" id="import-dialog-title" class="import-title">
          {{ dialogTitle }}
        </h2>

        <p class="import-hint">
          {{
            kind === 'calendar'
              ? $ngettext(
                  '%{count} event in this file',
                  '%{count} events in this file',
                  items.length,
                  { count: items.length }
                )
              : $ngettext(
                  '%{count} contact in this file',
                  '%{count} contacts in this file',
                  items.length,
                  { count: items.length }
                )
          }}
        </p>

        <div class="import-options" role="radiogroup" :aria-label="$gettext('Import target')">
          <label class="import-option" :class="{ 'import-option--disabled': !targets.length }">
            <input
              v-model="mode"
              type="radio"
              value="existing"
              name="import-target-mode"
              :disabled="!targets.length"
            />
            <span>{{
              kind === 'calendar'
                ? $gettext('Into an existing calendar')
                : $gettext('Into an existing address book')
            }}</span>
            <select
              v-model="targetUrl"
              class="import-option-control"
              :disabled="mode !== 'existing' || !targets.length"
              :aria-label="kind === 'calendar' ? $gettext('Calendar') : $gettext('Address book')"
            >
              <option v-for="t in targets" :key="t.url" :value="t.url">
                {{ t.displayName }}
              </option>
            </select>
          </label>

          <label class="import-option">
            <input v-model="mode" type="radio" value="new" name="import-target-mode" />
            <span>{{
              kind === 'calendar'
                ? $gettext('Into a new calendar')
                : $gettext('Into a new address book')
            }}</span>
            <input
              v-model="newName"
              type="text"
              class="import-option-control"
              :disabled="mode !== 'new'"
              :placeholder="$gettext('Name')"
              :aria-label="$gettext('Name')"
            />
          </label>
        </div>

        <div class="import-actions">
          <div class="spacer" />
          <oc-button appearance="outline" :disabled="importBusy" @click="close">
            {{ $gettext('Cancel') }}
          </oc-button>
          <oc-button
            appearance="filled"
            color-role="primary"
            :disabled="confirmDisabled"
            @click="confirm"
          >
            {{ importBusy ? $gettext('Importing…') : $gettext('Import') }}
          </oc-button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * ImportDialog – "where should this file go?" plus the import execution.
 *
 * Two modes share the same markup:
 *  - `standalone` (default): own overlay + dialog semantics, used inline by the
 *    Tools view (`v-if` opens it, `@close`/`@imported` are handled there).
 *  - embedded (`:standalone="false"`): rendered by the platform modal shell
 *    (`useModals().dispatchModal({ customComponent: ImportDialog })`) so the
 *    Files app can host it without navigating away. The shell owns the overlay,
 *    the focus trap and the title, hence no duplicate dialog semantics here.
 */
import { computed, onMounted, ref } from 'vue'
import { useGettext } from 'vue3-gettext'
import { useModals } from '@opencloud-eu/web-pkg'
import { useModalA11y } from '../composables/useModalA11y'
import {
  useImport,
  type ImportCounts,
  type ImportItem,
  type ImportKind,
  type ImportTarget
} from '../composables/useImport'

const props = withDefaults(
  defineProps<{
    kind: ImportKind
    items: ImportItem[]
    /** Existing collections to offer; loaded from the DAV services when omitted. */
    targets?: ImportTarget[]
    /** Preselected collection (e.g. the one selected in Settings → Data). */
    initialTargetUrl?: string
    /** Prefill for a newly created collection (X-WR-CALNAME or the file name). */
    suggestedName?: string
    /** Own overlay + focus trap; disable when hosted inside the platform modal. */
    standalone?: boolean
    /** Append an "open the app" hint to the result toast (Files app flow). */
    showOpenHint?: boolean
    /** Platform modal instance (only set when rendered via `dispatchModal`). */
    modal?: { id: string }
  }>(),
  {
    targets: undefined,
    initialTargetUrl: '',
    suggestedName: '',
    standalone: true,
    showOpenHint: false,
    modal: undefined
  }
)

const emit = defineEmits<{
  close: []
  imported: [counts: ImportCounts]
}>()

const { $gettext, $ngettext } = useGettext()
const { removeModal } = useModals()
// `useImport` captures gettext/messages/DAV services in *this* setup, so nothing
// below re-enters a composable from an event handler.
const { importBusy, loadTargets, importInto } = useImport()

const panelRef = ref<HTMLElement | null>(null)
const open = ref(false)
const loadedTargets = ref<ImportTarget[]>([])
const mode = ref<'existing' | 'new'>('existing')
const targetUrl = ref('')
const newName = ref(props.suggestedName)

const targets = computed(() => props.targets ?? loadedTargets.value)
const dialogTitle = computed(() =>
  props.kind === 'calendar' ? $gettext('Import events') : $gettext('Import contacts')
)
const confirmDisabled = computed(
  () => importBusy.value || (mode.value === 'existing' ? !targetUrl.value : !newName.value.trim())
)

/** Preselect the requested target (or the first one); fall back to "new". */
function applyDefaults(list: ImportTarget[]): void {
  const preferred =
    (props.initialTargetUrl && list.find((t) => t.url === props.initialTargetUrl)?.url) ||
    list[0]?.url ||
    ''
  targetUrl.value = preferred
  mode.value = preferred ? 'existing' : 'new'
}

onMounted(async () => {
  if (props.standalone) open.value = true
  if (props.targets) {
    applyDefaults(props.targets)
    return
  }
  const loaded = await loadTargets(props.kind)
  loadedTargets.value = loaded
  applyDefaults(loaded)
})

// Escape / Tab handling for the standalone overlay; the platform modal shell
// already does this for the embedded variant.
useModalA11y(panelRef, open, { onClose: () => close() })

function onOverlayClick(): void {
  if (props.standalone) close()
}

function close(): void {
  if (importBusy.value) return
  open.value = false
  if (props.modal?.id) {
    // Dismiss the platform modal we are rendered in (Files app flow).
    removeModal(props.modal.id)
  }
  emit('close')
}

async function confirm(): Promise<void> {
  const counts = await importInto(
    { kind: props.kind, items: props.items, suggestedName: props.suggestedName },
    { mode: mode.value, targetUrl: targetUrl.value, newName: newName.value },
    {
      hint: props.showOpenHint
        ? props.kind === 'calendar'
          ? $gettext('Open Calendar to see the imported events.')
          : $gettext('Open Contacts to see the imported contacts.')
        : undefined
    }
  )
  if (!counts) return
  emit('imported', counts)
  close()
}
</script>

<style>
/* Self-contained styles: the dialog is also rendered inside the Files app,
   where the Settings page's stylesheet is not loaded. */
.import-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(4px);
}

.import-embed {
  display: block;
  width: 100%;
}

.import-panel {
  background: var(--oc-role-surface-container-lowest, #ffffff);
  color: var(--oc-role-on-surface, #191c1d);
  border-radius: 16px;
  padding: 12px 24px 24px;
  width: 560px;
  max-width: 90vw;
  max-height: 85vh;
  overflow-y: auto;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
}

.import-panel--embedded {
  width: 100%;
  max-width: none;
  max-height: none;
  padding: 0;
  border-radius: 0;
  box-shadow: none;
  background: transparent;
}

.import-title {
  font-size: 1.125rem;
  font-weight: 600;
  margin-bottom: 14px;
}

.import-hint {
  font-size: 0.875rem;
  margin-bottom: 8px;
  color: var(--oc-role-on-surface-variant, #40484c);
}

.import-options {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 8px 0 16px;
}

.import-option {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: 0.875rem;
  cursor: pointer;
  user-select: none;
}

.import-option--disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.import-option input[type='radio'] {
  accent-color: var(--oc-role-primary, #00677f);
}

.import-option-control {
  flex: 1;
  min-width: 200px;
  padding: 6px 8px;
  font: inherit;
  color: inherit;
  background: var(--oc-role-surface, #fbfcfe);
  border: 1px solid var(--oc-role-outline-variant, #bfc8cc);
  border-radius: 8px;
}

.import-option-control:disabled {
  opacity: 0.5;
}

.import-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--oc-role-outline-variant, #bfc8cc);
}

.import-actions .spacer {
  flex: 1;
}

@media (max-width: 640px) {
  .import-panel {
    width: 100%;
    max-width: 100%;
    min-width: 0;
    height: 100%;
    max-height: 100%;
    border-radius: 0;
  }
}
</style>
