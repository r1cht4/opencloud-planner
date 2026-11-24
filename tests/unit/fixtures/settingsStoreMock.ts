/**
 * Mock for `src/settings/settingsStore` used by view/component specs.
 *
 * The real store loads one document per session over DAV; view specs want a
 * controllable document instead. The mock keeps the **real** resolver
 * (`resolveSettings`) and the real path writers, so a test asserts the same
 * precedence and validation the app uses — only the transport is replaced.
 *
 * Usage in a spec:
 *
 * ```ts
 * const state = vi.hoisted(() => ({ doc: {}, locked: [], admin: {}, calls: [], loaded: true, error: null }))
 * vi.mock('../../src/settings/settingsStore', async () => {
 *   const { createSettingsStoreMock } = await import('./fixtures/settingsStoreMock')
 *   return createSettingsStoreMock(state)
 * })
 * ```
 *
 * Set the document with `setMockSettingsDocument(state, doc)` — it updates both the
 * plain `doc` field and the shared reactive ref, so a change made **after** mount
 * reaches the mounted component (the resolved `settings` computed re-evaluates).
 */
import { computed, ref, type Ref } from 'vue'
import { deleteSettingPath, resolveSettings, writeSettingPath } from '../../../src/settings/schema'

export interface SettingsMockState {
  /** Raw (unresolved) user document. */
  doc: Record<string, unknown>
  /** Paths the fake admin locked. */
  locked: string[]
  /** Fake admin configuration (`defaults`, `enabledApps`, `filesSidebar`). */
  admin: Record<string, unknown>
  /** Every `update(path, value)` the component issued, in order. */
  calls: Array<[string, unknown]>
  /** Value of the store's `loaded` ref. */
  loaded: boolean
  /** Value of the store's `error` ref. */
  error: string | null
  /** Internal: the shared document ref (see `setMockSettingsDocument`). */
  docRef?: { value: Record<string, unknown> }
}

/** Point the (possibly already mounted) components at a new document. */
export function setMockSettingsDocument(
  state: SettingsMockState,
  doc: Record<string, unknown>
): void {
  state.doc = doc
  if (!state.docRef) {
    state.docRef = ref<Record<string, unknown>>(doc) as unknown as {
      value: Record<string, unknown>
    }
  }
  state.docRef.value = doc
}

export function createSettingsStoreMock(state: SettingsMockState) {
  if (!state.docRef) {
    state.docRef = ref<Record<string, unknown>>(state.doc) as unknown as {
      value: Record<string, unknown>
    }
  }
  const doc = state.docRef as unknown as Ref<Record<string, unknown>>
  const loaded = ref(true)
  const error = ref<string | null>(null)

  return {
    useSettings: () => {
      loaded.value = state.loaded
      error.value = state.error
      return {
        settings: computed(() => resolveSettings(doc.value, state.admin as never)),
        loaded,
        error,
        update: (path: string, value: unknown) => {
          state.calls.push([path, value])
          const next: Record<string, unknown> = JSON.parse(JSON.stringify(doc.value))
          if (value === undefined) deleteSettingPath(next, path)
          else writeSettingPath(next, path, value)
          doc.value = next
          state.doc = next
        },
        isLocked: (path: string) => state.locked.includes(path),
        reload: async (): Promise<void> => undefined
      }
    },
    // The route guards' bounded wait for the document (`whenSettingsLoaded`).
    whenSettingsLoaded: (): Promise<boolean> => Promise.resolve(loaded.value)
  }
}
