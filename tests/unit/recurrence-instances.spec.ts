import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const authState = vi.hoisted(() => ({ accessToken: 'test-token' }))

vi.mock('@opencloud-eu/web-pkg', () => ({
  useAuthStore: () => ({ accessToken: authState.accessToken })
}))

import {
  addExdateToIcs,
  buildIcs,
  expandRecurringEvents,
  parseIcsToEvent,
  upsertRecurrenceOverrideIcs
} from '../../src/composables/useCalendarService'

function stubUtcTz() {
  vi.stubGlobal('Intl', {
    ...Intl,
    DateTimeFormat: function () {
      return { resolvedOptions: () => ({ timeZone: 'UTC' }) }
    }
  } as any)
}

async function weeklyEvent() {
  const ics = await buildIcs({
    id: 'weekly-1',
    title: 'Weekly Sync',
    start: '2026-06-01 09:00',
    end: '2026-06-01 10:00',
    rrule: 'FREQ=WEEKLY'
  })
  const event = await parseIcsToEvent(ics, 'https://cloud.example/cal/')
  expect(event).not.toBeNull()
  return event!
}

describe('recurring instance EXDATE and RECURRENCE-ID handling', () => {
  beforeEach(() => {
    stubUtcTz()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('adds an EXDATE for a single occurrence', async () => {
    const event = await weeklyEvent()
    const occurrences = await expandRecurringEvents(
      [event],
      new Date('2026-06-01T00:00:00Z'),
      new Date('2026-06-30T23:59:59Z')
    )
    const second = occurrences.find((occurrence) => occurrence.start === '2026-06-08 09:00')

    expect(second?.recurrenceId).toBeDefined()

    const patched = await addExdateToIcs(event.rawIcs!, second!.recurrenceId!)

    expect(patched).toMatch(/EXDATE[^:]*:20260608T090000/)
  })

  it('expands a recurring event without an excluded occurrence', async () => {
    const event = await weeklyEvent()
    const occurrences = await expandRecurringEvents(
      [event],
      new Date('2026-06-01T00:00:00Z'),
      new Date('2026-06-30T23:59:59Z')
    )
    const second = occurrences.find((occurrence) => occurrence.start === '2026-06-08 09:00')
    const patched = await addExdateToIcs(event.rawIcs!, second!.recurrenceId!)
    const parsed = await parseIcsToEvent(patched, 'https://cloud.example/cal/')

    expect(parsed).not.toBeNull()

    const expanded = await expandRecurringEvents(
      [parsed!],
      new Date('2026-06-01T00:00:00Z'),
      new Date('2026-06-30T23:59:59Z')
    )

    expect(expanded.map((occurrence) => occurrence.start)).not.toContain('2026-06-08 09:00')
    expect(expanded.map((occurrence) => occurrence.start)).toContain('2026-06-15 09:00')
  })

  it('round-trips a RECURRENCE-ID override and uses it during expansion', async () => {
    const event = await weeklyEvent()
    const occurrences = await expandRecurringEvents(
      [event],
      new Date('2026-06-01T00:00:00Z'),
      new Date('2026-06-30T23:59:59Z')
    )
    const second = occurrences.find((occurrence) => occurrence.start === '2026-06-08 09:00')

    const patched = await upsertRecurrenceOverrideIcs(event.rawIcs!, second!.recurrenceId!, {
      title: 'Shifted Sync',
      start: '2026-06-08 13:00',
      end: '2026-06-08 14:00',
      location: 'Room 2',
      reminder: 15
    })

    expect(patched).toMatch(/RECURRENCE-ID[^:]*:20260608T090000/)
    expect(patched).toContain('SUMMARY:Shifted Sync')

    const parsed = await parseIcsToEvent(patched, 'https://cloud.example/cal/')
    expect(parsed).not.toBeNull()

    const expanded = await expandRecurringEvents(
      [parsed!],
      new Date('2026-06-01T00:00:00Z'),
      new Date('2026-06-30T23:59:59Z')
    )
    const override = expanded.find((occurrence) => occurrence.recurrenceId === second!.recurrenceId)

    expect(override).toBeDefined()
    expect(override!.title).toBe('Shifted Sync')
    expect(override!.start).toBe('2026-06-08 13:00')
    expect(override!.end).toBe('2026-06-08 14:00')
    expect(override!.location).toBe('Room 2')
    expect(override!.reminder).toBe(15)
  })
})
