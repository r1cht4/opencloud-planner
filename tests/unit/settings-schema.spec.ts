/**
 * Settings schema — pure resolution/document helpers.
 *
 * Precedence is the contract the whole feature rests on: a locked admin value
 * beats the user's choice, which beats an admin default, which beats the
 * built-in default; anything mistyped falls through to the next level instead of
 * poisoning the app with `undefined`.
 */
import { describe, expect, it } from 'vitest'
import {
  APP_DRAWER_SLOTS,
  DEFAULT_SETTINGS,
  FILES_SIDEBAR_SLOTS,
  parseSettingsDocument,
  resolveSettings,
  serializeSettingsDocument,
  type Settings
} from '../../src/settings/schema'

describe('resolveSettings', () => {
  it('defaults when empty', () => {
    expect(resolveSettings({}, {})).toEqual(DEFAULT_SETTINGS)
  })

  it('user overrides admin default', () => {
    const settings = resolveSettings(
      { calendar: { defaultView: 'day' } },
      { defaults: { calendar: { defaultView: 'month' } } }
    )

    expect(settings.calendar.defaultView).toBe('day')
  })

  it('locked admin value beats user', () => {
    const settings = resolveSettings(
      { general: { filesSidebar: ['calendar', 'tasks'] } },
      { defaults: { general: { filesSidebar: ['contacts'] } }, locked: ['general.filesSidebar'] }
    )

    expect(settings.general.filesSidebar).toEqual(['contacts'])
  })

  it('a lock without an admin default falls back to the built-in default, never the user value', () => {
    const settings = resolveSettings(
      { calendar: { defaultView: 'month' } },
      { locked: ['calendar.defaultView'] }
    )

    // The lock removes the user value from the candidates entirely.
    expect(settings.calendar.defaultView).toBe('week')
  })

  it('a lock with an invalid admin default falls back to the built-in default', () => {
    const settings = resolveSettings({ calendar: { defaultView: 'month' } }, {
      defaults: { calendar: { defaultView: 'year' as unknown as 'month' } },
      locked: ['calendar.defaultView']
    } as never)

    expect(settings.calendar.defaultView).toBe('week')
  })

  it('a lock without a default ignores the user value even when the built-in default would keep it', () => {
    const settings = resolveSettings(
      { tasks: { showCompleted: true } },
      { locked: ['tasks.showCompleted'] }
    )

    expect(settings.tasks.showCompleted).toBe(DEFAULT_SETTINGS.tasks.showCompleted)
  })

  it('invalid typed user value falls back', () => {
    const settings = resolveSettings({ calendar: { defaultView: 'year' } }, {})

    expect(settings.calendar.defaultView).toBe('week')
  })

  it('invalid typed user value falls back to the admin default', () => {
    const settings = resolveSettings(
      { calendar: { defaultView: 'year' } },
      { defaults: { calendar: { defaultView: 'month' } } }
    )

    expect(settings.calendar.defaultView).toBe('month')
  })

  it('drops invalid app keys from the user list', () => {
    const settings = resolveSettings({ general: { enabledApps: ['calendar', 'mail'] } }, {})

    expect(settings.general.enabledApps).toEqual(DEFAULT_SETTINGS.general.enabledApps)
  })

  it('keeps a valid default-calendar URL and leaves it unset by default', () => {
    const empty = resolveSettings({}, {})
    expect(empty.calendar.defaultCalendar).toBeUndefined()

    const withUrl = resolveSettings(
      { calendar: { defaultCalendar: 'https://cloud.example/caldav/user-1/personal/' } },
      {}
    )
    expect(withUrl.calendar.defaultCalendar).toBe('https://cloud.example/caldav/user-1/personal/')
  })

  it('ignores values from a newer document version', () => {
    const settings = resolveSettings(
      { version: 2, calendar: { defaultView: 'day' }, general: { filesSidebar: [] } },
      {}
    )

    expect(settings.calendar.defaultView).toBe(DEFAULT_SETTINGS.calendar.defaultView)
    // Value, not object identity: the resolver hands out fresh copies so a caller
    // can never mutate the defaults by editing a resolved settings object.
    expect(settings.general.filesSidebar).toEqual(DEFAULT_SETTINGS.general.filesSidebar)
    expect(settings.general.filesSidebar).not.toBe(DEFAULT_SETTINGS.general.filesSidebar)
  })

  it('still applies admin defaults for a newer document version', () => {
    const settings = resolveSettings(
      { version: 2, calendar: { defaultView: 'day' } },
      { defaults: { calendar: { defaultView: 'month' } } }
    )

    expect(settings.calendar.defaultView).toBe('month')
  })

  it('defaults when the document is not an object', () => {
    // parseSettingsDocument hands back {} for garbage, but be defensive anyway.
    expect(resolveSettings(null as unknown as Record<string, unknown>, {})).toEqual(
      DEFAULT_SETTINGS
    )
  })

  it('survives a malformed section (object expected)', () => {
    const settings = resolveSettings({ calendar: 'week', general: [1, 2] }, {})

    expect(settings).toEqual(DEFAULT_SETTINGS)
  })

  it('resolves nested admin defaults without touching unrelated defaults', () => {
    const settings = resolveSettings({}, { defaults: { reminders: { enabled: false } } })

    expect(settings.reminders.enabled).toBe(false)
    expect(settings.general.filesSidebar).toEqual(['calendar', 'contacts', 'tasks'])
  })

  it('keeps the per-app Files-sidebar list', () => {
    const settings = resolveSettings({ general: { filesSidebar: ['calendar'] } }, {})

    expect(settings.general.filesSidebar).toEqual(['calendar'])
  })

  it('accepts an empty Files-sidebar list (show none there)', () => {
    const settings = resolveSettings({ general: { filesSidebar: [] } }, {})

    expect(settings.general.filesSidebar).toEqual([])
  })

  it('drops unknown app keys from the Files-sidebar list', () => {
    const settings = resolveSettings({ general: { filesSidebar: ['calendar', 'mail'] } }, {})

    expect(settings.general.filesSidebar).toEqual(['calendar'])
  })

  it('boolean legacy value migrates', () => {
    // The first 2.0 pass stored one on/off switch; `true` still means "all apps".
    const on = resolveSettings({ general: { filesSidebar: true } }, {})
    expect(on.general.filesSidebar).toEqual(['calendar', 'contacts', 'tasks'])

    const off = resolveSettings({ general: { filesSidebar: false } }, {})
    expect(off.general.filesSidebar).toEqual([])
  })

  it('a Files-sidebar list with no usable entry falls through', () => {
    const settings = resolveSettings(
      { general: { filesSidebar: ['mail'] } },
      { defaults: { general: { filesSidebar: ['tasks'] } } }
    )

    expect(settings.general.filesSidebar).toEqual(['tasks'])
  })

  it('normalises a partial app-menu slot map and rejects an unknown slot', () => {
    // An admin only names the apps they care about; the others keep the default.
    const partial = resolveSettings({ general: { appDrawerPosition: { calendar: 'first' } } }, {})
    expect(partial.general.appDrawerPosition).toEqual({
      calendar: 'first',
      contacts: 'afterFiles',
      tasks: 'afterFiles'
    })

    // A typo in one slot must not silently move an entry: the whole value falls
    // through to the next level.
    const typo = resolveSettings(
      { general: { appDrawerPosition: { calendar: 'behind' } } },
      { defaults: { general: { appDrawerPosition: { calendar: 'last' } } } }
    )
    expect(typo.general.appDrawerPosition.calendar).toBe('last')
  })

  it('accepts every slot the settings UI offers, for both slot maps', () => {
    // The validator is the *_SLOTS list itself; a slot the UI lists but the
    // validator rejects would reset the whole map to the next level.
    for (const slot of FILES_SIDEBAR_SLOTS) {
      const settings = resolveSettings({ general: { filesSidebarPosition: { tasks: slot } } }, {})
      expect(settings.general.filesSidebarPosition.tasks).toBe(slot)
    }
    for (const slot of APP_DRAWER_SLOTS) {
      const settings = resolveSettings({ general: { appDrawerPosition: { tasks: slot } } }, {})
      expect(settings.general.appDrawerPosition.tasks).toBe(slot)
    }
    // A slot of the other map is not valid here.
    const crossed = resolveSettings({ general: { filesSidebarPosition: { tasks: 'first' } } }, {})
    expect(crossed.general.filesSidebarPosition.tasks).not.toBe('first')
  })

  it('accepts a numeric week start and the locale keyword', () => {
    expect(resolveSettings({ calendar: { weekStart: 0 } }, {}).calendar.weekStart).toBe(0)
    expect(resolveSettings({ calendar: { weekStart: 'locale' } }, {}).calendar.weekStart).toBe(
      'locale'
    )
    expect(resolveSettings({ calendar: { weekStart: 9 } }, {}).calendar.weekStart).toBe('locale')
  })

  // ── `general.navigation` arrived after `general.filesSidebar` ─────────────

  it('a document with filesSidebar but no navigation keeps the Files-sidebar entries', () => {
    // Written by a build that did not know `general.navigation` yet: the newer
    // `drawerOnly` default would silently hide every entry it asked for.
    const settings = resolveSettings({ general: { filesSidebar: ['calendar'] } }, {})

    expect(settings.general.navigation).toBe('filesSidebar')
    expect(settings.general.filesSidebar).toEqual(['calendar'])
  })

  it('the same holds for an admin filesSidebar default and its shortcut', () => {
    expect(
      resolveSettings({}, { defaults: { general: { filesSidebar: ['contacts'] } } }).general
        .navigation
    ).toBe('filesSidebar')
    // The documented `filesSidebar` shortcut ends up in `defaults` as well.
    expect(resolveSettings({}, { filesSidebar: ['tasks'] }).general.navigation).toBe('filesSidebar')
  })

  it('an explicit or locked navigation mode wins over the legacy rule', () => {
    const document = { general: { filesSidebar: ['calendar'] } }

    expect(
      resolveSettings({ general: { filesSidebar: ['calendar'], navigation: 'drawerOnly' } }, {})
        .general.navigation
    ).toBe('drawerOnly')
    expect(
      resolveSettings(document, { defaults: { general: { navigation: 'drawerOnly' } } }).general
        .navigation
    ).toBe('drawerOnly')
    // A lock without an admin default keeps the built-in default.
    expect(resolveSettings(document, { locked: ['general.navigation'] }).general.navigation).toBe(
      'drawerOnly'
    )
  })

  it('a document that sets neither key keeps the new default', () => {
    expect(resolveSettings({ general: { defaultApp: 'tasks' } }, {}).general.navigation).toBe(
      'drawerOnly'
    )
  })
})

describe('parseSettingsDocument', () => {
  it('invalid JSON → defaults', () => {
    expect(parseSettingsDocument('{x')).toEqual({})
  })

  it('empty and null documents → {}', () => {
    expect(parseSettingsDocument('')).toEqual({})
    expect(parseSettingsDocument(null)).toEqual({})
    expect(parseSettingsDocument('[]')).toEqual({})
    expect(parseSettingsDocument('"nope"')).toEqual({})
  })

  it('reads a valid document', () => {
    expect(parseSettingsDocument('{"version":1,"calendar":{"defaultView":"day"}}')).toEqual({
      version: 1,
      calendar: { defaultView: 'day' }
    })
  })

  it('keeps the whole document, including keys it does not know', () => {
    const doc = parseSettingsDocument('{"version":1,"calendar":{"defaultView":"day"}}')

    expect(doc.calendar).toEqual({ defaultView: 'day' })
  })
})

describe('serializeSettingsDocument', () => {
  it('keeps unknown keys', () => {
    const doc = parseSettingsDocument('{"version":1,"future":{"a":1}}')

    expect(serializeSettingsDocument(doc)).toContain('"future"')
  })

  it('stamps version 1 when the document has none', () => {
    expect(serializeSettingsDocument({})).toBe('{"version":1}')
  })

  it('keeps a newer version instead of downgrading it', () => {
    const text = serializeSettingsDocument({ version: 2, future: { a: 1 } })

    expect(JSON.parse(text).version).toBe(2)
  })

  it('round-trips through parse', () => {
    const doc: Record<string, unknown> = {
      version: 1,
      general: { filesSidebar: ['calendar'], enabledApps: ['calendar'] },
      'urn:foreign': { keep: ['me'] }
    }

    expect(parseSettingsDocument(serializeSettingsDocument(doc))).toEqual(doc)
  })
})

describe('DEFAULT_SETTINGS', () => {
  it('matches the documented defaults', () => {
    const expected: Settings = {
      version: 1,
      general: {
        filesSidebar: ['calendar', 'contacts', 'tasks'],
        filesSidebarPosition: { calendar: 'spaces', contacts: 'spaces', tasks: 'spaces' },
        filesSidebarOrder: ['calendar', 'contacts', 'tasks'],
        appDrawer: 'single',
        appDrawerApps: ['calendar', 'contacts', 'tasks'],
        appDrawerPosition: { calendar: 'afterFiles', contacts: 'afterFiles', tasks: 'afterFiles' },
        appDrawerOrder: ['calendar', 'contacts', 'tasks'],
        enabledApps: ['calendar', 'contacts', 'tasks'],
        navigation: 'drawerOnly',
        defaultApp: 'calendar',
        formatRegion: 'auto',
        timeFormat: 'auto'
      },
      calendar: {
        defaultView: 'week',
        dayStart: '06:00',
        weekStart: 'locale',
        weekNumbers: true,
        showWeekends: true,
        defaultDuration: 60,
        defaultReminders: []
      },
      contacts: { sortBy: 'lastName', displayOrder: 'firstLast' },
      tasks: { showCompleted: false },
      birthdays: { enabled: false },
      reminders: { enabled: true }
    }

    expect(DEFAULT_SETTINGS).toEqual(expected)
  })
})
