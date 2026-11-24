/**
 * Tests for patchIcs – data-loss prevention when updating calendar events.
 *
 * These tests verify that patchIcs updates only the UI-managed properties of a
 * VEVENT while leaving all other properties (ATTENDEE, ORGANIZER, X-* props,
 * additional VALARMs, etc.) completely untouched.
 */
import { describe, expect, it } from 'vitest'
import { patchIcs } from '../../src/composables/useCalendarService'

// ---------------------------------------------------------------------------
// Fixture: a realistic ICS that includes properties the UI does NOT model.
// It has: ATTENDEE, ORGANIZER, X-CUSTOM-PROP, and TWO VALARM subcomponents.
// ---------------------------------------------------------------------------

const RAW_ICS_TIMED = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//ThunderbirD//Calendar//EN',
  'BEGIN:VEVENT',
  'UID:preserve-me-uid-001',
  'DTSTAMP:20260101T000000Z',
  'DTSTART:20260601T090000',
  'DTEND:20260601T100000',
  'SUMMARY:Original Title',
  'DESCRIPTION:Original description',
  'LOCATION:Original location',
  'ORGANIZER;CN=Alice:mailto:alice@example.test',
  'ATTENDEE;CN=Bob;PARTSTAT=ACCEPTED:mailto:bob@example.test',
  'X-CUSTOM-PROP:do-not-touch',
  'BEGIN:VALARM',
  'ACTION:DISPLAY',
  'TRIGGER:-PT15M',
  'DESCRIPTION:Reminder 1',
  'END:VALARM',
  'BEGIN:VALARM',
  'ACTION:EMAIL',
  'TRIGGER:-PT60M',
  'DESCRIPTION:Email reminder',
  'END:VALARM',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n')

const RAW_ICS_ALLDAY = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Apple//Calendar//EN',
  'BEGIN:VEVENT',
  'UID:allday-uid-002',
  'DTSTAMP:20260101T000000Z',
  'DTSTART;VALUE=DATE:20260601',
  'DTEND;VALUE=DATE:20260602',
  'SUMMARY:All-Day Original',
  'ORGANIZER;CN=Charlie:mailto:charlie@example.test',
  'ATTENDEE;CN=Dana:mailto:dana@example.test',
  'X-CUSTOM-PROP:preserve-this',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n')

const RAW_ICS_WITH_DESCRIPTION = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//OpenCloud//Planner//EN',
  'BEGIN:VEVENT',
  'UID:desc-removal-uid-003',
  'DTSTAMP:20260101T000000Z',
  'DTSTART:20260607T140000',
  'DTEND:20260607T150000',
  'SUMMARY:Has Description',
  'DESCRIPTION:Will be removed',
  'ORGANIZER;CN=Eve:mailto:eve@example.test',
  'ATTENDEE;CN=Frank:mailto:frank@example.test',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n')

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('patchIcs – data-loss prevention', () => {
  it('updates SUMMARY and DTSTART/DTEND while preserving ATTENDEE, ORGANIZER, X-CUSTOM-PROP', async () => {
    const result = await patchIcs(RAW_ICS_TIMED, {
      title: 'New Title',
      start: '2026-06-07 14:00',
      end: '2026-06-07 15:00',
      reminder: 30
    })

    // UI-managed properties updated
    expect(result).toContain('SUMMARY:New Title')
    expect(result).toMatch(/DTSTART;TZID=[^:]+:20260607T140000/)
    expect(result).toMatch(/DTEND;TZID=[^:]+:20260607T150000/)

    // Core data-loss guarantee: non-UI properties preserved
    expect(result).toContain('ATTENDEE')
    expect(result).toContain('bob@example.test')
    expect(result).toContain('ORGANIZER')
    expect(result).toContain('alice@example.test')
    expect(result).toContain('X-CUSTOM-PROP:do-not-touch')

    // UID must never change
    expect(result).toContain('UID:preserve-me-uid-001')
  })

  it('preserves the second VALARM when updating the first', async () => {
    const result = await patchIcs(RAW_ICS_TIMED, {
      title: 'New Title',
      start: '2026-06-07 14:00',
      end: '2026-06-07 15:00',
      reminder: 30
    })

    // First VALARM should now reflect the new 30-minute reminder
    expect(result).toContain('TRIGGER:-PT30M')

    // Second VALARM (ACTION:EMAIL with -PT60M) must still be present
    expect(result).toContain('ACTION:EMAIL')
    expect(result).toContain('Email reminder')

    // There must be two VALARMs in the output
    const valarmMatches = result.match(/BEGIN:VALARM/g)
    expect(valarmMatches).not.toBeNull()
    expect(valarmMatches!.length).toBe(2)
  })

  it('emits DTSTART;VALUE=DATE for all-day events', async () => {
    const result = await patchIcs(RAW_ICS_ALLDAY, {
      title: 'Updated All-Day',
      start: '2026-06-10',
      end: '2026-06-11'
    })

    // All-day format: VALUE=DATE, no time component
    expect(result).toMatch(/DTSTART[^:]*VALUE=DATE[^:]*:20260610/)
    expect(result).toMatch(/DTEND[^:]*VALUE=DATE[^:]*:20260611/)

    // Non-UI properties preserved for all-day event too
    expect(result).toContain('ATTENDEE')
    expect(result).toContain('dana@example.test')
    expect(result).toContain('ORGANIZER')
    expect(result).toContain('charlie@example.test')
    expect(result).toContain('X-CUSTOM-PROP:preserve-this')
  })

  it('removes DESCRIPTION when not provided but keeps ATTENDEE', async () => {
    const result = await patchIcs(RAW_ICS_WITH_DESCRIPTION, {
      title: 'No Description Now',
      start: '2026-06-07 14:00',
      end: '2026-06-07 15:00'
      // no description field
    })

    // DESCRIPTION must be absent
    expect(result).not.toMatch(/^DESCRIPTION:/m)

    // ATTENDEE must still be present — the core data-loss guarantee
    expect(result).toContain('ATTENDEE')
    expect(result).toContain('frank@example.test')
    expect(result).toContain('ORGANIZER')
    expect(result).toContain('eve@example.test')

    // SUMMARY updated
    expect(result).toContain('SUMMARY:No Description Now')
  })

  it('does not change the UID during a patch', async () => {
    const result = await patchIcs(RAW_ICS_TIMED, {
      title: 'Check UID',
      start: '2026-06-07 09:00',
      end: '2026-06-07 10:00'
    })

    expect(result).toContain('UID:preserve-me-uid-001')
  })
})
