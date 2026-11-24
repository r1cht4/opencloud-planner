<!--
  BackupCard – the "backup & restore" group content of Settings → Data.

  Self-contained: no props, one event.
    props:  none
    emits:  `restored` — a restore finished (the host may refresh collection lists)

  Buttons:
    * Create backup (.zip)  → buildBackup() + download (one .ics per calendar,
      one .vcf per address book, manifest.json with names/colors)
    * Restore from backup  → picks a .zip, shows a preview dialog with one row per
      archive file (existing collection vs. new collection + name) and imports
      through the shared lossless path (`useImport`).

  Mount it anywhere; it loads the collection lists itself.
-->
<template>
  <div class="backup-card">
    <div class="settings-button-row">
      <oc-button appearance="outline" :disabled="busy" @click="onCreateBackup">
        <oc-icon name="download" size="small" />
        <span>{{ $gettext('Create backup (.zip)') }}</span>
      </oc-button>

      <oc-button appearance="outline" :disabled="busy" @click="fileInput?.click()">
        <oc-icon name="upload" size="small" />
        <span>{{ $gettext('Restore from backup') }}</span>
      </oc-button>

      <input
        ref="fileInput"
        type="file"
        accept=".zip,application/zip"
        class="file-input-hidden"
        :aria-label="$gettext('Backup file')"
        @change="onFileChosen"
      />
    </div>

    <p v-if="busy" class="settings-hint" role="status">{{ $gettext('Working…') }}</p>

    <Teleport to="body">
      <div v-if="showPreview" class="modal-overlay" @click.self="closePreview">
        <div
          ref="panelRef"
          class="modal-panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="backup-restore-title"
        >
          <h2 id="backup-restore-title" class="modal-title">
            {{ $gettext('Restore from backup') }}
          </h2>

          <p class="settings-hint">
            {{
              $gettext(
                'Choose where each file of the backup should be imported. Existing calendars and address books are matched by name.'
              )
            }}
          </p>

          <ul class="restore-list">
            <li v-for="item in planItems" :key="item.fileName" class="restore-row">
              <div class="restore-file">
                <span class="restore-name">{{ item.displayName }}</span>
                <span class="restore-meta"> {{ kindLabel(item.kind) }} · {{ item.fileName }} </span>
              </div>

              <div class="restore-target">
                <select
                  v-model="choices[item.fileName].mode"
                  class="settings-select settings-select--fill"
                  :aria-label="`${$gettext('Restore target')}: ${item.displayName}`"
                >
                  <option value="existing" :disabled="!targetsFor(item).length">
                    {{ $gettext('Existing') }}
                  </option>
                  <option value="new">{{ $gettext('New') }}</option>
                </select>

                <select
                  v-if="choices[item.fileName].mode === 'existing'"
                  v-model="choices[item.fileName].url"
                  class="settings-select settings-select--fill"
                  :aria-label="`${$gettext('Target')}: ${item.displayName}`"
                >
                  <option v-for="target in targetsFor(item)" :key="target.url" :value="target.url">
                    {{ target.displayName }}
                  </option>
                </select>

                <input
                  v-else
                  v-model="choices[item.fileName].newName"
                  type="text"
                  class="form-input"
                  :placeholder="$gettext('Name')"
                  :aria-label="`${$gettext('Name of the new calendar or address book')}: ${item.displayName}`"
                />
              </div>
            </li>
          </ul>

          <p v-if="skippedLabel" class="settings-hint">{{ skippedLabel }}</p>

          <div class="modal-actions">
            <div class="spacer" />
            <oc-button appearance="outline" :disabled="busy" @click="closePreview">
              {{ $gettext('Cancel') }}
            </oc-button>
            <oc-button
              appearance="filled"
              :disabled="busy || !planItems.length"
              @click="confirmRestore"
            >
              {{ busy ? $gettext('Restoring…') : $gettext('Restore') }}
            </oc-button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useGettext } from 'vue3-gettext'
import { useMessages } from '@opencloud-eu/web-pkg'
import { useModalA11y } from '../../composables/useModalA11y'
import { useImport } from '../../composables/useImport'
import {
  buildBackup,
  downloadBlob,
  planRestore,
  type BackupKind,
  type RestorePlanItem,
  type RestoreTarget
} from '../../tools/backup'
import { readZip, type ZipEntry } from '../../tools/zip'
import '../../styles/modal.css'
import '../../styles/settings.css'

defineOptions({ name: 'BackupCard' })

const emit = defineEmits<{ restored: [] }>()

const { $gettext, $ngettext } = useGettext()
const { showMessage, showErrorMessage } = useMessages()
const { prepareImport, loadTargets, runImport } = useImport()

const fileInput = ref<HTMLInputElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)
const busy = ref(false)
const showPreview = ref(false)

const entries = ref<ZipEntry[]>([])
const planItems = ref<RestorePlanItem[]>([])
const skipped = ref<string[]>([])
const calendars = ref<RestoreTarget[]>([])
const addressBooks = ref<RestoreTarget[]>([])

interface TargetChoice {
  mode: 'existing' | 'new'
  url: string
  newName: string
}

const choices = ref<Record<string, TargetChoice>>({})

const isDialogOpen = computed(() => showPreview.value)

useModalA11y(panelRef, isDialogOpen, { onClose: closePreview })

const skippedLabel = computed(() =>
  skipped.value.length
    ? $gettext('Not used from this backup: %{files}', { files: skipped.value.join(', ') })
    : ''
)

function kindLabel(kind: BackupKind): string {
  return kind === 'calendar' ? $gettext('Calendar') : $gettext('Address book')
}

function targetsFor(item: RestorePlanItem): RestoreTarget[] {
  return item.kind === 'calendar' ? calendars.value : addressBooks.value
}

async function onCreateBackup() {
  if (busy.value) return
  busy.value = true
  try {
    const { blob, failed } = await buildBackup()
    const stamp = new Date().toISOString().slice(0, 10)
    downloadBlob(blob, `planner-backup-${stamp}.zip`)
    // A collection whose fetch failed MUST be named — a silent
    // "Backup created" over a zip that stores an empty collection loses data.
    if (failed.length > 0) {
      showErrorMessage({
        title: $gettext('Incomplete backup'),
        desc: $gettext(
          'These calendars and address books could not be read and are not in the backup: %{names}',
          {
            names: failed.map((failure) => failure.displayName).join(', ')
          }
        )
      })
    } else {
      showMessage({ title: $gettext('Backup created') })
    }
  } catch (err) {
    console.warn('[planner] backup failed:', err)
    showErrorMessage({ title: $gettext('Could not create the backup') })
  } finally {
    busy.value = false
  }
}

function closePreview() {
  if (busy.value) return
  showPreview.value = false
}

async function onFileChosen(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  busy.value = true
  try {
    const buffer = await file.arrayBuffer()
    const archive = await readZip(buffer)
    entries.value = archive

    calendars.value = await loadTargets('calendar')
    addressBooks.value = await loadTargets('contacts')

    const plan = planRestore(archive, {
      calendars: calendars.value,
      addressBooks: addressBooks.value
    })
    if (plan.items.length === 0) {
      showErrorMessage({ title: $gettext('This backup contains no calendars or address books') })
      return
    }

    planItems.value = plan.items
    skipped.value = plan.skipped
    const next: Record<string, TargetChoice> = {}
    for (const item of plan.items) {
      const targets = targetsFor(item)
      next[item.fileName] = {
        mode: item.existingUrl || !targets.length ? 'existing' : 'new',
        url: item.existingUrl ?? targets[0]?.url ?? '',
        newName: item.suggestedName
      }
      if (!targets.length) next[item.fileName].mode = 'new'
    }
    choices.value = next
    showPreview.value = true
  } catch (err) {
    console.warn('[planner] reading the backup failed:', err)
    showErrorMessage({
      title: $gettext('This file is not a readable zip archive')
    })
  } finally {
    busy.value = false
  }
}

async function confirmRestore() {
  if (busy.value) return
  busy.value = true

  const byName = new Map(entries.value.map((entry) => [entry.name, entry]))
  const decoder = new TextDecoder('utf-8')
  let created = 0
  let exists = 0
  let failed = 0

  try {
    for (const item of planItems.value) {
      const entry = byName.get(item.fileName)
      const choice = choices.value[item.fileName]
      if (!entry || !choice) continue

      const prepared = await prepareImport(
        item.kind === 'calendar' ? 'calendar' : 'contacts',
        decoder.decode(entry.data),
        item.fileName
      )
      if (!prepared) continue

      const selection =
        choice.mode === 'existing'
          ? { mode: 'existing' as const, targetUrl: choice.url }
          : { mode: 'new' as const, newName: choice.newName }

      const counts = await runImport(prepared, selection)
      if (!counts) continue
      created += counts.created
      exists += counts.exists
      failed += counts.failed
    }

    const parts: string[] = []
    if (created > 0)
      parts.push(
        $ngettext('%{count} item restored', '%{count} items restored', created, { count: created })
      )
    if (exists > 0)
      parts.push(
        $ngettext(
          '%{count} item skipped (already exists)',
          '%{count} items skipped (already exist)',
          exists,
          { count: exists }
        )
      )
    if (failed > 0)
      parts.push(
        $ngettext('%{count} item failed', '%{count} items failed', failed, { count: failed })
      )

    if (failed > 0 && created === 0) {
      showErrorMessage({ title: parts.join(', ') || $gettext('Restore failed') })
    } else {
      showMessage({ title: parts.join(', ') || $gettext('Nothing to restore') })
    }

    showPreview.value = false
    emit('restored')
  } catch (err) {
    console.warn('[planner] restore failed:', err)
    showErrorMessage({ title: $gettext('Restore failed') })
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.file-input-hidden {
  display: none;
}

.restore-list {
  list-style: none;
  margin: 12px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.restore-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 0;
  border-bottom: 1px solid var(--oc-role-outline-variant, #bfc8cc);
}
.restore-row:last-child {
  border-bottom: none;
}

.restore-file {
  display: flex;
  flex-direction: column;
}

.restore-name {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--oc-role-on-surface, #191c1d);
}

.restore-meta {
  font-size: 0.75rem;
  color: var(--oc-role-on-surface-variant, #40484c);
}

.restore-target {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
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
