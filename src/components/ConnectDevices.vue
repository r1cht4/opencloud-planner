<template>
  <div class="connect-card">
    <ul class="connect-rows">
      <li v-for="row in rows" :key="row.key" class="connect-row">
        <span class="connect-label">{{ row.label }}</span>
        <code :ref="(el) => setValueRef(row.key, el)" class="connect-value">{{ row.value }}</code>
        <oc-button
          appearance="raw"
          size="small"
          class="connect-copy"
          :aria-label="`${$gettext('Copy')} ${row.label}`"
          @click="copy(row)"
        >
          <oc-icon :name="copiedKey === row.key ? 'check' : 'file-copy'" size="small" />
          <span class="connect-copy-text">{{ $gettext('Copy') }}</span>
        </oc-button>
      </li>
    </ul>

    <p class="card-hint">
      {{
        $gettext(
          'Clients that support auto-discovery only need %{origin} — it is served via %{caldav} and %{carddav}.',
          { origin, caldav: wellKnownCaldav, carddav: wellKnownCarddav }
        )
      }}
    </p>

    <div class="connect-credentials">
      <p class="card-hint">
        {{
          $gettext(
            'Native apps must sign in with an app token, never with your OpenCloud password.'
          )
        }}
      </p>
      <a class="connect-link" :href="appTokenUrl">{{ $gettext('Create an app token') }}</a>
      <p class="card-hint">
        {{ $gettext('You find it in your account settings under App Tokens.') }}
      </p>
    </div>

    <div class="connect-clients">
      <details class="connect-client">
        <summary>{{ $gettext('Android (DAVx5)') }}</summary>
        <p class="card-hint">
          {{
            $gettext(
              'Add an account with "Login with URL and user name", use the CalDAV URL above as the base URL, and your app token as the password.'
            )
          }}
        </p>
      </details>

      <details class="connect-client">
        <summary>{{ $gettext('Thunderbird') }}</summary>
        <p class="card-hint">
          {{
            $gettext(
              'Create a new CalDAV calendar or CardDAV address book and use %{origin} as the location.',
              { origin }
            )
          }}
        </p>
      </details>

      <details class="connect-client">
        <summary>{{ $gettext('iOS and macOS') }}</summary>
        <p class="card-hint">
          {{
            $gettext(
              'Settings → Calendar → Accounts → Other → Add CalDAV Account: server %{host}, your username and app token. Add the CardDAV account the same way under Contacts.',
              { host }
            )
          }}
        </p>
      </details>
    </div>

    <p v-if="copyHint" class="card-hint connect-copy-hint" role="status">{{ copyHint }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useGettext } from 'vue3-gettext'
import { useMessages, useUserStore } from '@opencloud-eu/web-pkg'

defineOptions({ name: 'ConnectDevices' })

const { $gettext } = useGettext()
const { showMessage, showErrorMessage } = useMessages()

const origin = window.location.origin
const host = window.location.host
const wellKnownCaldav = `${origin}/.well-known/caldav`
const wellKnownCarddav = `${origin}/.well-known/carddav`

/**
 * OpenCloud's account page exposes app tokens as an account extension; the
 * extension id is registered by the web runtime itself
 * (`com.github.opencloud-eu.web.runtime.preferences-panels.app-tokens`), so we
 * link straight to it instead of making users hunt through the account menu.
 */
const APP_TOKENS_EXTENSION_ID = 'com.github.opencloud-eu.web.runtime.preferences-panels.app-tokens'

/** Route href that works with both history and hash routing hosts. */
function appHref(path: string): string {
  const base = document.querySelector('base')?.getAttribute('href') || '/'
  const normalized = path.replace(/^\//, '')
  if (window.location.hash.startsWith('#/')) return `${base}#/${normalized}`
  return `${base}${normalized}`
}

const appTokenUrl = appHref(`/account/extension?extension-id=${APP_TOKENS_EXTENSION_ID}`)

/** Username from the OpenCloud user store; hidden entirely when unavailable. */
const userStore = (() => {
  try {
    return useUserStore()
  } catch {
    return null
  }
})()
const username = computed(() => userStore?.user?.onPremisesSamAccountName || '')

const caldavUrl = `${origin}/caldav/`
const carddavUrl = `${origin}/carddav/`

interface ConnectRow {
  key: string
  label: string
  value: string
}

const rows = computed<ConnectRow[]>(() => {
  const list: ConnectRow[] = [
    { key: 'caldav', label: $gettext('CalDAV URL'), value: caldavUrl },
    { key: 'carddav', label: $gettext('CardDAV URL'), value: carddavUrl }
  ]
  if (username.value) {
    list.push({ key: 'username', label: $gettext('Username'), value: username.value })
  }
  return list
})

const valueRefs = new Map<string, HTMLElement>()
function setValueRef(key: string, el: unknown) {
  if (el instanceof HTMLElement) valueRefs.set(key, el)
  else valueRefs.delete(key)
}

const copiedKey = ref<string>('')
const copyHint = ref('')

/** Select the row text so the user can copy it with the keyboard (fallback). */
function selectRowText(key: string) {
  const el = valueRefs.get(key)
  if (!el) return
  const range = document.createRange()
  range.selectNodeContents(el)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

async function copy(row: ConnectRow) {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
    await navigator.clipboard.writeText(row.value)
    copiedKey.value = row.key
    copyHint.value = ''
    showMessage({ title: $gettext('Copied to clipboard') })
    setTimeout(() => {
      if (copiedKey.value === row.key) copiedKey.value = ''
    }, 1500)
  } catch {
    // No clipboard API (insecure context, denied permission): select the text
    // and tell the user to press Ctrl+C instead of failing silently.
    selectRowText(row.key)
    copyHint.value = $gettext('Press Ctrl+C to copy the selected text.')
    showErrorMessage({ title: $gettext('Press Ctrl+C to copy the selected text.') })
  }
}
</script>

<style scoped>
.connect-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.card-hint {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--oc-role-on-surface-variant, #40484c);
}

.connect-rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.connect-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.connect-label {
  font-size: 0.875rem;
  color: var(--oc-role-on-surface-variant, #40484c);
  min-width: 110px;
}

.connect-value {
  flex: 1;
  min-width: 0;
  padding: 6px 10px;
  border: 1px solid var(--oc-role-outline-variant, #bfc8cc);
  border-radius: 4px;
  background: var(--oc-role-surface, #fbfcfe);
  color: var(--oc-role-on-surface, #191c1d);
  font-size: 0.8125rem;
  font-family: var(--oc-font-family-monospace, monospace);
  overflow-x: auto;
  white-space: nowrap;
  user-select: all;
}

.connect-copy-text {
  margin-left: 4px;
  font-size: 0.75rem;
}

.connect-credentials {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-top: 12px;
  border-top: 1px solid var(--oc-role-outline-variant, #bfc8cc);
}

/* Same link token and treatment as the other in-app links (`ContactDetail`'s
   `.link`): primary on the card surface is ≥ 4.5:1, and the underline keeps the
   link recognisable without relying on colour alone. */
.connect-link {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--oc-role-primary, #00677f);
  text-decoration: underline;
  text-underline-offset: 2px;
  align-self: flex-start;
}

.connect-link:hover {
  color: var(--oc-role-primary, #00677f);
  text-decoration-thickness: 2px;
}

.connect-link:focus-visible {
  outline: 2px solid var(--oc-role-primary, #00677f);
  outline-offset: 2px;
  border-radius: 2px;
}

.connect-clients {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 12px;
  border-top: 1px solid var(--oc-role-outline-variant, #bfc8cc);
}

.connect-client summary {
  cursor: pointer;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--oc-role-on-surface, #191c1d);
}

.connect-client p {
  margin: 6px 0 0;
}

.connect-copy-hint {
  color: var(--oc-role-error, #b3261e);
}

@media (max-width: 640px) {
  .connect-card {
    padding: 12px;
  }

  .connect-row {
    flex-direction: column;
    align-items: stretch;
  }

  .connect-label {
    min-width: 0;
  }

  .connect-value {
    white-space: normal;
    word-break: break-all;
  }
}
</style>
