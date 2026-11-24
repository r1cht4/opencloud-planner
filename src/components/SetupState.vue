<template>
  <section class="setup-state" aria-labelledby="setup-state-title">
    <oc-icon name="error-warning" size="xlarge" class="setup-icon" />

    <h1 id="setup-state-title" class="setup-title">
      {{ heading }}
    </h1>

    <p class="setup-reason">{{ reason }}</p>

    <p v-if="serverStatus" class="setup-detail">
      <span class="setup-detail-label">{{ $gettext('Server response') }}</span>
      <code>{{ serverStatus }}</code>
    </p>

    <!-- Non-admins get guidance, not commands: they cannot change the server. -->
    <p v-if="!isAdmin" class="setup-user">
      {{ userHint }}
    </p>

    <div v-else class="setup-admin">
      <h2 class="setup-subtitle">{{ $gettext('Administrator setup') }}</h2>

      <ol class="setup-steps">
        <li v-for="step in steps" :key="step.id" class="setup-step">
          <p class="setup-step-text">{{ stepLabel(step.id) }}</p>

          <div class="setup-code">
            <pre class="setup-code-block"><code>{{ step.code }}</code></pre>
            <oc-button
              appearance="raw"
              size="small"
              class="setup-copy"
              :aria-label="`${$gettext('Copy')}: ${stepLabel(step.id)}`"
              @click="copy(step)"
            >
              <oc-icon :name="copiedStep === step.id ? 'check' : 'file-copy'" size="small" />
            </oc-button>
          </div>
        </li>
      </ol>

      <div class="setup-actions">
        <oc-button appearance="filled" :disabled="probing" @click="testConnection">
          <oc-spinner v-if="probing" size="small" />
          <span>{{ probing ? $gettext('Testing…') : $gettext('Test connection') }}</span>
        </oc-button>

        <a class="setup-link" :href="INSTALL_GUIDE_URL" target="_blank" rel="noopener noreferrer">
          {{ $gettext('Install guide') }}
        </a>
      </div>

      <p v-if="testHint" class="setup-hint" role="status">{{ testHint }}</p>
    </div>

    <p v-if="copyHint" class="setup-hint" role="status">{{ copyHint }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useGettext } from 'vue3-gettext'
import { useAbility } from '@opencloud-eu/web-pkg'
import { useConnectionProbe, type ProbeOutcome } from '../composables/useConnectionProbe'
import {
  ADMIN_SETUP_STEPS,
  INSTALL_GUIDE_URL,
  probeOutcomeLabel,
  type AdminSetupStep,
  type AdminSetupStepId
} from '../setup/connection'
import { APP_NAME } from '../navigation'

defineOptions({ name: 'SetupState' })

const props = defineProps<{
  /** Why the app is showing this instead of its content. Never `'ok'`. */
  outcome: ProbeOutcome
}>()

const { $gettext } = useGettext()
// Captured at setup; the handlers only use the captured references.
const { outcome: probeState, probing, retest, lastResult } = useConnectionProbe()

/**
 * Administrator detection: ability to read every setting is the same gate the
 * OpenCloud admin UI uses, so no extra role lookup (and no extra request) is
 * needed. Wrapped because the ability may not be installed in unit tests.
 */
const isAdmin = (() => {
  try {
    return useAbility().can('read-all', 'Setting')
  } catch {
    return false
  }
})()

const steps = ADMIN_SETUP_STEPS

/** What went wrong, in plain words. */
/** Heading per outcome: a stopped server is not a missing setup. */
const heading = computed(() => {
  switch (props.outcome) {
    case 'unavailable':
      return $gettext('The calendar server is not reachable')
    case 'unauthorized':
      return $gettext('Signing in to the calendar server failed')
    case 'error':
      return $gettext('%{app} cannot connect', { app: APP_NAME })
    default:
      return $gettext('%{app} is not set up yet', { app: APP_NAME })
  }
})

/** What a non-admin can do about it. */
const userHint = computed(() =>
  props.outcome === 'not-configured'
    ? $gettext('Your administrator still needs to finish the setup of %{app}.', {
        app: APP_NAME
      })
    : $gettext('Please try again later. If the problem persists, contact your administrator.')
)

const reason = computed(() => {
  switch (props.outcome) {
    case 'not-configured':
      return $gettext(
        'The calendar server is not connected to this OpenCloud instance. The proxy does not route the DAV endpoints yet.'
      )
    case 'unavailable':
      return $gettext(
        'The calendar server cannot be reached right now. The service may be stopped or still starting.'
      )
    case 'unauthorized':
      return $gettext(
        'OpenCloud could not sign in to the calendar server. The user mapping of the DAV endpoints is not working.'
      )
    default:
      return $gettext(
        'The calendar server answered with an unexpected error. Check the server logs for details.'
      )
  }
})

/** `HTTP 502` for admins — the detail that makes the diagnosis quick. */
const serverStatus = computed(() =>
  isAdmin && lastResult.value?.status ? `HTTP ${lastResult.value.status}` : ''
)

function stepLabel(id: AdminSetupStepId): string {
  switch (id) {
    case 'compose-file':
      return $gettext('Add radicale/radicale.yml to COMPOSE_FILE in your .env file:')
    case 'proxy-routes':
      return $gettext(
        'Check that config/opencloud/proxy.yaml (shipped upstream) contains these routes, which forward the DAV endpoints to Radicale with remote_user_header: X-Remote-User:'
      )
    default:
      return $gettext('Apply the changes:')
  }
}

const copiedStep = ref<AdminSetupStepId | ''>('')
const copyHint = ref('')

/** Copy one step's code; without the Clipboard API, tell the user to copy by hand. */
async function copy(step: AdminSetupStep) {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
    await navigator.clipboard.writeText(step.code)
    copiedStep.value = step.id
    copyHint.value = ''
    setTimeout(() => {
      if (copiedStep.value === step.id) copiedStep.value = ''
    }, 1500)
  } catch {
    copyHint.value = $gettext('Press Ctrl+C to copy the selected text.')
  }
}

const testHint = ref('')

/** Admin pressed "Test connection": re-probe and report the result in place. */
async function testConnection() {
  testHint.value = ''
  await retest()
  const outcome = probeState.value
  if (outcome === 'ok') {
    copyHint.value = ''
    testHint.value = $gettext('Connection works — the app is ready.')
    return
  }
  testHint.value = $gettext('The connection test still fails (%{outcome}).', {
    outcome: probeOutcomeLabel(outcome, $gettext)
  })
}
</script>

<style scoped>
.setup-state {
  max-width: 46rem;
  margin: 3rem auto;
  padding: 24px 28px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: var(--oc-role-surface-container-lowest, #ffffff);
  border: 1px solid var(--oc-role-outline-variant, #bfc8cc);
  border-radius: 12px;
  color: var(--oc-role-on-surface, #191c1d);
}

.setup-icon {
  color: var(--oc-role-error, #b3261e);
}

.setup-title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
}

.setup-reason {
  margin: 0;
  font-size: 0.9375rem;
  color: var(--oc-role-on-surface-variant, #40484c);
}

.setup-detail {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.8125rem;
  color: var(--oc-role-on-surface-variant, #40484c);
}

.setup-detail code,
.setup-code-block {
  font-family: var(--oc-font-family-monospace, monospace);
}

.setup-user {
  margin: 0;
  font-size: 0.9375rem;
  font-weight: 500;
}

.setup-admin {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--oc-role-outline-variant, #bfc8cc);
}

.setup-subtitle {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
}

.setup-steps {
  margin: 0;
  padding-left: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.setup-step-text {
  margin: 0 0 6px;
  font-size: 0.875rem;
  line-height: 1.45;
}

.setup-code {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.setup-code-block {
  flex: 1;
  min-width: 0;
  margin: 0;
  padding: 8px 10px;
  background: var(--oc-role-surface, #fbfcfe);
  border: 1px solid var(--oc-role-outline-variant, #bfc8cc);
  border-radius: 4px;
  font-size: 0.8125rem;
  overflow-x: auto;
  white-space: pre;
}

.setup-copy {
  flex: none;
}

.setup-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
}

.setup-link {
  font-size: 0.875rem;
  color: var(--oc-role-secondary, #20434f);
  text-decoration: underline;
}

.setup-hint {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--oc-role-on-surface-variant, #40484c);
}
</style>
