/**
 * Admin config (`apps.yaml` `config` block → `applicationConfig`).
 *
 * The raw object is YAML, so it is untrusted: documented keys are accepted,
 * everything else is dropped, and the two shortcuts (`enabledApps`,
 * `filesSidebar`) are folded into `defaults` so the settings resolver only ever
 * has to look at one place.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { getAdminConfig, setAdminConfig } from '../../src/config/appConfig'
import { getDAVConfig } from '../../src/config/davConfig'
import { DEFAULT_SETTINGS, resolveSettings } from '../../src/settings/schema'

beforeEach(() => {
  setAdminConfig(undefined)
})

describe('setAdminConfig', () => {
  it('accepts documented keys', () => {
    setAdminConfig({
      caldavUrl: 'https://cloud.example/caldav',
      carddavUrl: 'https://cloud.example/carddav',
      enabledApps: ['calendar', 'tasks'],
      filesSidebar: ['calendar', 'tasks'],
      defaults: { calendar: { defaultView: 'month' }, reminders: { enabled: false } },
      locked: ['general.filesSidebar', 'reminders.enabled']
    })

    const config = getAdminConfig()

    expect(config.caldavUrl).toBe('https://cloud.example/caldav')
    expect(config.carddavUrl).toBe('https://cloud.example/carddav')
    expect(config.enabledApps).toEqual(['calendar', 'tasks'])
    expect(config.filesSidebar).toEqual(['calendar', 'tasks'])
    expect(config.locked).toEqual(['general.filesSidebar', 'reminders.enabled'])
    expect(config.defaults?.calendar?.defaultView).toBe('month')
    expect(config.defaults?.reminders?.enabled).toBe(false)
  })

  it('folds the shortcuts into defaults.general', () => {
    setAdminConfig({ filesSidebar: ['tasks'], enabledApps: ['calendar'] })

    expect(getAdminConfig().defaults?.general).toMatchObject({
      filesSidebar: ['tasks'],
      enabledApps: ['calendar']
    })
  })

  it('accepts an empty Files-sidebar list ("put none there")', () => {
    setAdminConfig({ filesSidebar: [] })

    expect(getAdminConfig().filesSidebar).toEqual([])
    expect(getAdminConfig().defaults?.general?.filesSidebar).toEqual([])
  })

  it('drops unknown app keys from the Files-sidebar list', () => {
    setAdminConfig({ filesSidebar: ['calendar', 'mail', 3] })

    expect(getAdminConfig().filesSidebar).toEqual(['calendar'])
  })

  it('drops invalid enabledApps entries', () => {
    setAdminConfig({ enabledApps: ['calendar', 'mail', 42, null, 'tasks'] })

    expect(getAdminConfig().enabledApps).toEqual(['calendar', 'tasks'])
  })

  it('ignores an enabledApps list that has no valid entry', () => {
    setAdminConfig({ enabledApps: ['mail', 'drive'] })

    expect(getAdminConfig().enabledApps).toBeUndefined()
  })

  it('drops unknown keys and mistyped values', () => {
    setAdminConfig({
      caldavUrl: '',
      carddavUrl: 42,
      filesSidebar: ['mail'],
      somethingElse: 'ignored',
      defaults: { calendar: { defaultView: 'year', weekNumbers: 'yes' }, nope: { a: 1 } },
      locked: ['general.filesSidebar', 'does.not.exist', 7]
    })

    const config = getAdminConfig()

    expect(config).toEqual({ locked: ['general.filesSidebar'] })
  })

  it('keeps a valid default-calendar URL and drops a non-string one', () => {
    setAdminConfig({
      defaults: { calendar: { defaultCalendar: 'https://cloud.example/caldav/u/p/' } }
    })

    expect(getAdminConfig().defaults?.calendar?.defaultCalendar).toBe(
      'https://cloud.example/caldav/u/p/'
    )

    setAdminConfig({ defaults: { calendar: { defaultCalendar: 5 } } })
    expect(getAdminConfig().defaults).toBeUndefined()
  })

  it('resets when called without a configuration', () => {
    setAdminConfig({ caldavUrl: 'https://cloud.example/caldav' })
    setAdminConfig(undefined)

    expect(getAdminConfig()).toEqual({})
  })

  it('survives a non-object argument', () => {
    setAdminConfig('nonsense')
    expect(getAdminConfig()).toEqual({})

    setAdminConfig(null)
    expect(getAdminConfig()).toEqual({})
  })

  it('feeds resolveSettings (admin default + lock)', () => {
    setAdminConfig({
      filesSidebar: ['contacts'],
      locked: ['general.filesSidebar'],
      defaults: { calendar: { defaultView: 'month' } }
    })

    const settings = resolveSettings({ calendar: { defaultView: 'day' } }, getAdminConfig())

    // Locked admin value wins over anything the user stored.
    expect(settings.general.filesSidebar).toEqual(['contacts'])
    expect(settings.calendar.defaultView).toBe('day')
    expect(settings.calendar.defaultDuration).toBe(DEFAULT_SETTINGS.calendar.defaultDuration)
  })
})

describe('davConfig', () => {
  it('legacy caldavUrl still read by getDAVConfig', () => {
    setAdminConfig({
      caldavUrl: 'https://cloud.example/caldav',
      carddavUrl: 'https://cloud.example/carddav'
    })

    expect(getDAVConfig()).toEqual({
      caldavUrl: 'https://cloud.example/caldav',
      carddavUrl: 'https://cloud.example/carddav'
    })
  })

  it('returns no URLs when nothing is configured (same-origin defaults apply)', () => {
    expect(getDAVConfig()).toEqual({ caldavUrl: undefined, carddavUrl: undefined })
  })
})
