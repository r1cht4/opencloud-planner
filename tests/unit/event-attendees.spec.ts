// @vitest-environment happy-dom
/**
 * ORGANIZER / ATTENDEE support.
 *
 * Covers the whole read-only pipeline:
 *   - `parseIcsToEvent` fills `organizer`/`attendees` (CN → name, `mailto:`
 *     stripped, PARTSTAT/ROLE upper-cased) — Thunderbird and Google fixtures
 *   - `expandRecurringEvents` uses the *occurrence's* component, so a
 *     RECURRENCE-ID override with its own attendee list is rendered as such
 *   - `EventDialog` shows Organizer + Participants (preview and edit mode) and
 *     hides the block when the event has neither
 *   - an edit through the dialog payload keeps the invitation data: `patchIcs`
 *     only touches the UI-managed properties, so ATTENDEE/ORGANIZER survive
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'

vi.mock('vue3-gettext', () => ({
  useGettext: () => ({ $gettext: (s: string) => s })
}))

import EventDialog from '../../src/components/calendar/EventDialog.vue'
import {
  hasParticipants,
  participantStatus,
  participantStatusLabel,
  personLabel
} from '../../src/composables/eventPeople'
import {
  expandRecurringEvents,
  parseIcsToEvent,
  patchIcs
} from '../../src/composables/useCalendarService'
import type { CalendarCollection, CalendarEvent } from '../../src/types'

// ── Thunderbird: ORGANIZER + one fully-specified ATTENDEE ────────────────────
const THUNDERBIRD_ICS = [
  'BEGIN:VCALENDAR',
  'PRODID:-//Mozilla.org/NONSGML Mozilla Calendar V1.1//EN',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:tb-event-1@example.org',
  'DTSTAMP:20260101T080000Z',
  'SUMMARY:Team Sync',
  'DTSTART:20260615T120000Z',
  'DTEND:20260615T130000Z',
  'ORGANIZER;CN=Alice:mailto:alice@example.org',
  'ATTENDEE;CN=Bob;PARTSTAT=ACCEPTED;ROLE=REQ-PARTICIPANT:mailto:bob@example.org',
  'X-MOZ-GENERATION:3',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n')

// ── Google Calendar: CUTYPE/X-NUM-GUESTS params, quoted CN, CN-less attendee ──
const GOOGLE_ICS = [
  'BEGIN:VCALENDAR',
  'PRODID:-//Google Inc//Google Calendar 70.9054//EN',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:google-event-1@google.com',
  'DTSTAMP:20260101T080000Z',
  'SUMMARY:Quarterly Review',
  'DTSTART:20260616T090000Z',
  'DTEND:20260616T100000Z',
  'ORGANIZER;CN="Doe, John":mailto:john@example.com',
  'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;CN=Bob Example;X-NUM-GUESTS=0:mailto:bob@example.com',
  'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=OPT-PARTICIPANT;PARTSTAT=DECLINED:mailto:carol@example.com',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n')

// ── master + RECURRENCE-ID override that carries its own smaller attendee list ─
const OVERRIDE_ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Google Inc//Google Calendar 70.9054//EN',
  'BEGIN:VEVENT',
  'UID:series-1@example.org',
  'DTSTAMP:20260101T080000Z',
  'DTSTART:20260601T090000Z',
  'DTEND:20260601T100000Z',
  'SUMMARY:Weekly Sync',
  'RRULE:FREQ=WEEKLY;COUNT=4',
  'ORGANIZER;CN=Alice:mailto:alice@example.org',
  'ATTENDEE;CN=Bob;PARTSTAT=ACCEPTED;ROLE=REQ-PARTICIPANT:mailto:bob@example.org',
  'ATTENDEE;CN=Carol;PARTSTAT=TENTATIVE;ROLE=OPT-PARTICIPANT:mailto:carol@example.org',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:series-1@example.org',
  'DTSTAMP:20260101T080000Z',
  'RECURRENCE-ID:20260608T090000Z',
  'DTSTART:20260608T090000Z',
  'DTEND:20260608T093000Z',
  'SUMMARY:Weekly Sync (small)',
  'ORGANIZER;CN=Alice:mailto:alice@example.org',
  'ATTENDEE;CN=Dave;PARTSTAT=NEEDS-ACTION;ROLE=REQ-PARTICIPANT:mailto:dave@example.org',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n')

const NO_PEOPLE_ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:x',
  'BEGIN:VEVENT',
  'UID:solo-1',
  'DTSTAMP:20260101T080000Z',
  'SUMMARY:Focus time',
  'DTSTART:20260617T090000Z',
  'DTEND:20260617T100000Z',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n')

const calendars: CalendarCollection[] = [
  { url: 'cal-1', displayName: 'Personal', color: '#00677F', description: '', ctag: '' }
]

/* ── EventDialog stubs (same minimal design-system stand-ins as event-dialog) ── */

const OcTextInputStub = defineComponent({
  name: 'OcTextInput',
  props: { modelValue: { type: String, default: '' }, disabled: Boolean },
  emits: ['update:modelValue'],
  setup:
    (props, { emit }) =>
    () =>
      h('input', {
        type: 'text',
        value: props.modelValue,
        disabled: props.disabled,
        onInput: (e: Event) => emit('update:modelValue', (e.target as HTMLInputElement).value)
      })
})

const OcTextareaStub = defineComponent({
  name: 'OcTextarea',
  props: { modelValue: { type: String, default: '' }, disabled: Boolean },
  emits: ['update:modelValue'],
  setup:
    (props, { emit }) =>
    () =>
      h('textarea', {
        value: props.modelValue,
        disabled: props.disabled,
        onInput: (e: Event) => emit('update:modelValue', (e.target as HTMLTextAreaElement).value)
      })
})

const OcButtonStub = defineComponent({
  name: 'OcButton',
  props: { submit: { type: String, default: null }, disabled: Boolean },
  emits: ['click'],
  setup:
    (props, { slots, emit }) =>
    () =>
      h(
        'button',
        {
          type: props.submit ?? 'button',
          disabled: props.disabled,
          onClick: (e: MouseEvent) => emit('click', e)
        },
        slots.default?.()
      )
})

const OcIconStub = defineComponent({
  name: 'OcIcon',
  setup: () => () => h('span', { class: 'oc-icon' })
})

const stubs = {
  'oc-text-input': OcTextInputStub,
  'oc-textarea': OcTextareaStub,
  'oc-button': OcButtonStub,
  'oc-icon': OcIconStub
}

let wrapper: VueWrapper | null = null

function mountDialog(props: Record<string, unknown>) {
  wrapper = mount(EventDialog, {
    props: { open: true, event: null, seed: null, calendars, ...props },
    global: { stubs },
    attachTo: document.body
  })
  return wrapper
}

function qa<T extends Element>(selector: string): T[] {
  return Array.from(document.body.querySelectorAll<T>(selector))
}

function q<T extends Element>(selector: string): T {
  const el = document.body.querySelector<T>(selector)
  if (!el) throw new Error(`missing ${selector}`)
  return el
}

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

describe('parseIcsToEvent – organizer and attendees', () => {
  it('reads a Thunderbird ORGANIZER/ATTENDEE (CN, mailto, PARTSTAT, ROLE)', async () => {
    const event = await parseIcsToEvent(THUNDERBIRD_ICS, 'cal-1')

    expect(event?.organizer).toEqual({ name: 'Alice', email: 'alice@example.org' })
    expect(event?.attendees).toEqual([
      { name: 'Bob', email: 'bob@example.org', partstat: 'ACCEPTED', role: 'REQ-PARTICIPANT' }
    ])
  })

  it('reads Google-style params, a quoted CN and an attendee without CN', async () => {
    const event = await parseIcsToEvent(GOOGLE_ICS, 'cal-1')

    expect(event?.organizer).toEqual({ name: 'Doe, John', email: 'john@example.com' })
    expect(event?.attendees).toEqual([
      {
        name: 'Bob Example',
        email: 'bob@example.com',
        partstat: 'NEEDS-ACTION',
        role: 'REQ-PARTICIPANT'
      },
      // No CN → no name; the address is used for display.
      { email: 'carol@example.com', partstat: 'DECLINED', role: 'OPT-PARTICIPANT' }
    ])
    expect(personLabel(event!.attendees![1])).toBe('carol@example.com')
  })

  it('leaves organizer/attendees undefined for a private event', async () => {
    const event = await parseIcsToEvent(NO_PEOPLE_ICS, 'cal-1')

    expect(event?.organizer).toBeUndefined()
    expect(event?.attendees).toBeUndefined()
    expect(hasParticipants(event!)).toBe(false)
  })
})

describe('expandRecurringEvents – per-occurrence attendees', () => {
  it('uses the override VEVENT attendee list for that occurrence only', async () => {
    const master = await parseIcsToEvent(OVERRIDE_ICS, 'cal-1')
    expect(master?.attendees?.map((a) => a.email)).toEqual(['bob@example.org', 'carol@example.org'])

    const occurrences = await expandRecurringEvents(
      [master!],
      new Date('2026-06-01T00:00:00Z'),
      new Date('2026-06-30T23:59:59Z')
    )

    const overridden = occurrences.find((o) => o.recurrenceId === '2026-06-08T09:00:00Z')
    expect(overridden?.recurrenceId).toBeDefined()
    expect(overridden?.attendees).toEqual([
      { name: 'Dave', email: 'dave@example.org', partstat: 'NEEDS-ACTION', role: 'REQ-PARTICIPANT' }
    ])
    expect(overridden?.organizer).toEqual({ name: 'Alice', email: 'alice@example.org' })

    const plain = occurrences.find((o) => o.recurrenceId === '2026-06-15T09:00:00Z')
    expect(plain?.attendees?.map((a) => a.email)).toEqual(['bob@example.org', 'carol@example.org'])
  })
})

describe('eventPeople helpers', () => {
  it('maps PARTSTAT values to status buckets and translated labels', () => {
    expect(participantStatus('accepted')).toBe('accepted')
    expect(participantStatus('NEEDS-ACTION')).toBe('needs-action')
    expect(participantStatus(undefined)).toBe('unknown')

    const t = (text: string) => `<${text}>`
    expect(participantStatusLabel('ACCEPTED', t)).toBe('<Accepted>')
    expect(participantStatusLabel('DECLINED', t)).toBe('<Declined>')
    expect(participantStatusLabel('tentative', t)).toBe('<Tentative>')
    expect(participantStatusLabel('NEEDS-ACTION', t)).toBe('<Needs action>')
    expect(participantStatusLabel('DELEGATED', t)).toBe('<Delegated>')
    // No PARTSTAT → no badge (organizer, bare attendee).
    expect(participantStatusLabel(undefined, t)).toBe('')
  })

  it('prefers the CN name and falls back to the address', () => {
    expect(personLabel({ name: '  Alice  ', email: 'alice@example.org' })).toBe('Alice')
    expect(personLabel({ name: '   ', email: 'bob@example.org' })).toBe('bob@example.org')
    expect(personLabel({ email: 'carol@example.org' })).toBe('carol@example.org')
  })

  it('hasParticipants is true when only an organizer is present', () => {
    expect(hasParticipants({ organizer: { email: 'a@example.org' } })).toBe(true)
    expect(hasParticipants({ attendees: [{ email: 'b@example.org' }] })).toBe(true)
    expect(hasParticipants({})).toBe(false)
    expect(hasParticipants({ attendees: [] })).toBe(false)
  })
})

describe('EventDialog – read-only participants', () => {
  it('shows Organizer and Participants with textual statuses in preview mode', async () => {
    const event = (await parseIcsToEvent(THUNDERBIRD_ICS, 'cal-1'))!
    mountDialog({ event })

    const people = q('.event-people')
    expect(people.textContent).toContain('Organizer')
    expect(people.textContent).toContain('Alice')
    expect(people.textContent).toContain('Participants')
    expect(people.textContent).toContain('Bob')

    // Status is spelled out, not colour-only.
    const badge = q<HTMLElement>('.people-badge')
    expect(badge.textContent?.trim()).toBe('Accepted')
    expect(badge.className).toContain('people-badge--accepted')

    // Preview mode: no edit hint, nothing editable in the block.
    expect(qa('.event-people input, .event-people textarea')).toHaveLength(0)
    expect(people.textContent).not.toContain('managed in the inviting calendar client')
  })

  it('renders the same list read-only in edit mode with the inviting-client hint', async () => {
    const event = (await parseIcsToEvent(GOOGLE_ICS, 'cal-1'))!
    const dialog = mountDialog({ event })

    const editBtn = qa<HTMLButtonElement>('.modal-panel button').find(
      (b) => b.textContent?.trim() === 'Edit'
    )
    editBtn!.click()
    await dialog.vm.$nextTick()

    const people = q('.event-people')
    expect(people.textContent).toContain('Doe, John')
    expect(people.textContent).toContain('Bob Example')
    expect(people.textContent).toContain('Needs action')
    expect(people.textContent).toContain('Declined')
    expect(people.textContent).toContain('managed in the inviting calendar client')
    // Still read-only: the block contains no form controls.
    expect(qa('.event-people input, .event-people textarea, .event-people select')).toHaveLength(0)
  })

  it('hides the block for events without organizer/attendees', async () => {
    const event = (await parseIcsToEvent(NO_PEOPLE_ICS, 'cal-1'))!
    mountDialog({ event })

    expect(qa('.event-people')).toHaveLength(0)
  })

  it('keeps ATTENDEE/ORGANIZER when saving the dialog payload', async () => {
    const master = (await parseIcsToEvent(THUNDERBIRD_ICS, 'cal-1'))!
    const dialog = mountDialog({ event: master })

    // preview → edit → rename → submit
    qa<HTMLButtonElement>('.modal-panel button')
      .find((b) => b.textContent?.trim() === 'Edit')!
      .click()
    await dialog.vm.$nextTick()

    const title = qa<HTMLInputElement>('.modal-panel input[type="text"]')[0]
    title.value = 'Team Sync (renamed)'
    title.dispatchEvent(new Event('input'))
    await dialog.vm.$nextTick()

    q<HTMLFormElement>('.modal-panel form').dispatchEvent(new Event('submit', { cancelable: true }))
    await dialog.vm.$nextTick()

    const payloads = dialog.emitted('save') as unknown[][]
    expect(payloads).toHaveLength(1)
    const payload = payloads[0][0] as {
      title: string
      start: string
      end: string
      description?: string
      location?: string
      isAllDay: boolean
      rrule?: string
      reminders: number[]
    }

    // Exactly what Calendar.vue does with the payload (`{ ...master, ...patch }`).
    const patched = await patchIcs(master.rawIcs!, { ...master, ...payload })

    expect(payload.title).toBe('Team Sync (renamed)')
    // RFC 5545 folding inserts CRLF+space; unfold before matching long lines.
    const unfolded = patched.replace(/\r\n /g, '')
    expect(unfolded).toContain('SUMMARY:Team Sync (renamed)')
    expect(unfolded).toContain('ORGANIZER;CN=Alice:mailto:alice@example.org')
    expect(unfolded).toContain(
      'ATTENDEE;CN=Bob;PARTSTAT=ACCEPTED;ROLE=REQ-PARTICIPANT:mailto:bob@example.org'
    )

    // …and the re-parsed event still exposes them.
    const reread = await parseIcsToEvent(patched, 'cal-1')
    expect(reread?.organizer).toEqual({ name: 'Alice', email: 'alice@example.org' })
    expect(reread?.attendees).toEqual([
      { name: 'Bob', email: 'bob@example.org', partstat: 'ACCEPTED', role: 'REQ-PARTICIPANT' }
    ])
  })
})

describe('EventDialog – attendees survive an edit of an occurrence-backed event', () => {
  it('keeps the master attendee list when only the title changes', async () => {
    const master = (await parseIcsToEvent(OVERRIDE_ICS, 'cal-1'))!
    const updated: CalendarEvent = { ...master, title: master.title, location: 'Room 2' }
    const patched = await patchIcs(master.rawIcs!, updated)

    expect(patched).toContain('LOCATION:Room 2')
    expect(patched.match(/ATTENDEE/g)).toHaveLength(3) // 2 master + 1 override
  })
})
