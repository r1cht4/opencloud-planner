<template>
  <SettingsRow
    :label="$gettext('Date and time format')"
    :hint="$gettext('Example: %{sample}', { sample: formatSample(formatLocale) })"
    :locked="isLocked('general.formatRegion')"
    label-for="setting-general-format-region"
  >
    <select
      id="setting-general-format-region"
      class="settings-select"
      data-setting="general.formatRegion"
      :value="settings.general.formatRegion"
      :disabled="isLocked('general.formatRegion')"
      @change="update('general.formatRegion', valueOf($event))"
    >
      <option v-for="option in regionOptions" :key="option.value" :value="option.value">
        {{ option.label }}
      </option>
    </select>
  </SettingsRow>

  <SettingsRow
    :label="$gettext('Clock')"
    :locked="isLocked('general.timeFormat')"
    label-for="setting-general-time-format"
  >
    <select
      id="setting-general-time-format"
      class="settings-select"
      data-setting="general.timeFormat"
      :value="settings.general.timeFormat"
      :disabled="isLocked('general.timeFormat')"
      @change="update('general.timeFormat', valueOf($event))"
    >
      <option v-for="option in clockOptions" :key="option.value" :value="option.value">
        {{ option.label }}
      </option>
    </select>
  </SettingsRow>
</template>

<script setup lang="ts">
/**
 * Date/time format rows of Settings → General → group "Format": the region whose
 * formats are used and the 12/24-hour clock. Resolution lives in
 * `settings/formatLocale.ts`. Region names come from `Intl.DisplayNames`, so they
 * need no translation.
 *
 * The live example ("Example: 24/11/2026, 14:05") is the hint of the region row —
 * it is what the choice actually changes.
 */
import { computed } from 'vue'
import { useGettext } from 'vue3-gettext'
import { useSettings } from '../../settings/settingsStore'
import {
  FORMAT_REGIONS,
  browserFormatRegion,
  buildFormatLocale,
  formatSample,
  regionLabel,
  useFormatLocale
} from '../../settings/formatLocale'
import SettingsRow from './SettingsRow.vue'
import { valueOf } from './settingsForm'
import '../../styles/settings.css'

defineOptions({ name: 'FormatSettings' })

const gettext = useGettext()
const { $gettext } = gettext
const { settings, update, isLocked } = useSettings()
const formatLocale = useFormatLocale()

const regionOptions = computed(() => {
  const lang = gettext.current
  const detected = browserFormatRegion()
  const auto = detected
    ? $gettext('Automatic (browser: %{region})', { region: regionLabel(detected, lang) })
    : $gettext('Automatic (browser)')
  const regions = [...FORMAT_REGIONS] as string[]
  const current = settings.value.general.formatRegion
  // An admin default outside the list must still be shown as selected.
  if (current !== 'auto' && !regions.includes(current)) regions.push(current)
  return [
    { value: 'auto', label: auto },
    ...regions
      .map((region) => ({
        value: region,
        label: `${regionLabel(region, lang)} — ${formatSample(buildFormatLocale(lang, region, 'auto'))}`
      }))
      .sort((a, b) => a.label.localeCompare(b.label))
  ]
})

const clockOptions = computed(() => [
  { value: 'auto', label: $gettext('As in the region') },
  { value: '24h', label: $gettext('24-hour (14:05)') },
  { value: '12h', label: $gettext('12-hour (2:05 PM)') }
])
</script>
