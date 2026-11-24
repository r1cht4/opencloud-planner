// @vitest-environment happy-dom
/**
 * Event search.
 *
 * `eventSearch` is pure and covers the matching rules (title/location/description,
 * case- and diacritics-insensitive, multi-term AND), ordering and the result cap;
 * the component test pins the listbox contract the page and the a11y story rely
 * on: ArrowUp/Down + Enter + Escape, `aria-activedescendant`, `role="option"`,
 * calendar colour dot and the "loaded period" note.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'

vi.mock('vue3-gettext', () => ({
  useGettext: () => ({ $gettext: (s: string) => s, current: { value: 'en' } })
}))

import EventSearch from '../../src/components/calendar/EventSearch.vue'
import {
  matchesEventQuery,
  normalizeSearchText,
  searchEvents,
  searchResultLabels,
  SEARCH_RESULT_LIMIT
} from '../../src/composables/eventSearch'
import type { CalendarCollection, CalendarEvent } from '../../src/types'

function ev(partial: Partial<CalendarEvent> & { id: string }): CalendarEvent {
  return {
    title: '',
    start: '2026-06-15 09:00',
    end: '2026-06-15 10:00',
    calendarId: 'cal-1',
    ...partial
  }
}

const events: CalendarEvent[] = [
  ev({ id: 'e1', title: 'Weekly Sync', start: '2026-06-15 09:00' }),
  ev({
    id: 'e2',
    title: 'Dentist',
    start: '2026-06-10 14:00',
    location: 'Müller Straße 5',
    end: '2026-06-10 15:00'
  }),
  ev({
    id: 'e3',
    title: 'Planning',
    start: '2026-06-12 11:00',
    description: 'Sync the roadmap with the sync-team',
    end: '2026-06-12 12:00'
  }),
  ev({ id: 'e4', title: 'Lunch', start: '2026-06-20 12:00', end: '2026-06-20 13:00' })
]

const calendars: CalendarCollection[] = [
  { url: 'cal-1', displayName: 'Personal', color: '#00677F', description: '', ctag: '' },
  { url: 'cal-2', displayName: 'Work', color: '#C2185B', description: '', ctag: '' }
]

describe('normalizeSearchText', () => {
  it('lowercases and strips diacritics', () => {
    expect(normalizeSearchText('Müller')).toBe('muller')
    expect(normalizeSearchText('Crème Brûlée')).toBe('creme brulee')
    expect(normalizeSearchText('ÁÉÍÓÚ')).toBe('aeiou')
    expect(normalizeSearchText(undefined)).toBe('')
  })
})

describe('matchesEventQuery', () => {
  it('matches title, location and description case-insensitively', () => {
    expect(matchesEventQuery(events[0], 'weekly')).toBe(true)
    expect(matchesEventQuery(events[1], 'MüLLer')).toBe(true)
    expect(matchesEventQuery(events[2], 'roadmap')).toBe(true)
    expect(matchesEventQuery(events[3], 'weekly')).toBe(false)
  })

  it('is diacritics-insensitive in both directions', () => {
    // unaccented query finds accented data …
    expect(matchesEventQuery(events[1], 'muller')).toBe(true)
    // … and an accented query finds unaccented data.
    expect(matchesEventQuery(ev({ id: 'x', title: 'Muller Street' }), 'Müller')).toBe(true)
  })

  it('requires every whitespace-separated term (AND)', () => {
    expect(matchesEventQuery(events[2], 'planning sync')).toBe(true)
    expect(matchesEventQuery(events[2], 'planning lunch')).toBe(false)
    // Empty / blank queries never match.
    expect(matchesEventQuery(events[0], '')).toBe(false)
    expect(matchesEventQuery(events[0], '   ')).toBe(false)
  })
})

describe('searchEvents', () => {
  it('returns nothing for an empty query', () => {
    expect(searchEvents(events, '')).toEqual([])
    expect(searchEvents(events, '  ')).toEqual([])
  })

  it('sorts matches by start', () => {
    const results = searchEvents(events, 'sync')
    // e3 (planning, 12 June) matches through its description, e1 through title.
    expect(results.map((e) => e.start)).toEqual(['2026-06-12 11:00', '2026-06-15 09:00'])
    expect(results.map((e) => e.id)).toEqual(['e3', 'e1'])
  })

  it('puts an all-day event before a timed event of the same day', () => {
    const allDay = ev({
      id: 'ad',
      title: 'Holiday',
      start: '2026-06-12',
      end: '2026-06-13',
      isAllDay: true
    })
    const timed = ev({ id: 'td', title: 'Holiday lunch', start: '2026-06-12 12:00' })
    expect(searchEvents([timed, allDay], 'holiday').map((e) => e.id)).toEqual(['ad', 'td'])
  })

  it('caps the result list (default 20) and keeps the earliest matches', () => {
    const many = Array.from({ length: SEARCH_RESULT_LIMIT + 5 }, (_, i) =>
      ev({
        id: `m${i}`,
        title: `Match ${i}`,
        start: `2026-06-${String((i % 28) + 1).padStart(2, '0')} 09:00`
      })
    )
    expect(searchEvents(many, 'match')).toHaveLength(SEARCH_RESULT_LIMIT)
    expect(searchEvents(many, 'match', { limit: 3 })).toHaveLength(3)

    const sorted = searchEvents(many, 'match', { limit: 3 }).map((e) => e.start)
    expect(sorted).toEqual([...sorted].sort())
  })

  it('searchResultLabels formats date, time and the jump target', () => {
    const timed = searchResultLabels(events[0], 'en-DE')
    expect(timed.isoDate).toBe('2026-06-15')
    expect(timed.time).toBe('09:00')
    // the time follows the format locale's clock, not a fixed 24 h string
    expect(searchResultLabels(events[0], 'en-US').time).toMatch(/^09:00\s?AM$/)
    expect(timed.date).toContain('15')

    const allDay = searchResultLabels(
      ev({ id: 'ad', title: 'Holiday', start: '2026-06-12', isAllDay: true }),
      'en'
    )
    expect(allDay.isoDate).toBe('2026-06-12')
    expect(allDay.time).toBe('')
  })
})

/* ── component ───────────────────────────────────────────────────────────── */

const OcIconStub = defineComponent({
  name: 'OcIcon',
  setup: () => () => h('span', { class: 'oc-icon' })
})

let wrapper: VueWrapper | null = null

function mountSearch(list: CalendarEvent[] = events) {
  wrapper = mount(EventSearch, {
    props: { events: list, calendars },
    global: { stubs: { 'oc-icon': OcIconStub } },
    attachTo: document.body
  })
  return wrapper
}

function input(): HTMLInputElement {
  const el = document.body.querySelector<HTMLInputElement>('.event-search-input')
  if (!el) throw new Error('missing search input')
  return el
}

function options(): HTMLElement[] {
  return Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]'))
}

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

describe('EventSearch component', () => {
  it('labels the input for assistive tech and renders a listbox of matches', async () => {
    mountSearch()
    const el = input()
    expect(el.getAttribute('aria-label')).toBe('Search events')
    expect(el.getAttribute('role')).toBe('combobox')
    expect(el.getAttribute('aria-expanded')).toBe('false')

    el.value = 'sync'
    el.dispatchEvent(new Event('input'))
    await wrapper!.vm.$nextTick()

    expect(el.getAttribute('aria-expanded')).toBe('true')
    expect(document.body.querySelector('[role="listbox"]')).toBeTruthy()
    // "date, time title" per row; the locale's date layout is not pinned.
    const rows = options().map((o) => o.textContent?.replace(/\s+/g, ' ').trim())
    expect(rows).toHaveLength(2)
    expect(rows[0]).toContain('11:00')
    expect(rows[0]).toContain('Planning')
    expect(rows[1]).toMatch(/09:00/)
    expect(rows[1]).toContain('Weekly Sync')
    expect(rows[0]).toMatch(/Jun/)
    // Colour dot + the "loaded period" note.
    expect(document.body.querySelector('.event-search-dot')).toBeTruthy()
    expect(document.body.textContent).toContain('Search covers the loaded period')
  })

  it('supports ArrowDown/ArrowUp, aria-activedescendant, Enter and Escape', async () => {
    mountSearch()
    const el = input()
    el.value = 'sync'
    el.dispatchEvent(new Event('input'))
    await wrapper!.vm.$nextTick()

    expect(el.hasAttribute('aria-activedescendant')).toBe(false)

    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    await wrapper!.vm.$nextTick()
    expect(el.getAttribute('aria-activedescendant')).toBe('event-search-results-option-0')
    expect(options()[0].getAttribute('aria-selected')).toBe('true')

    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    await wrapper!.vm.$nextTick()
    expect(el.getAttribute('aria-activedescendant')).toBe('event-search-results-option-1')

    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
    await wrapper!.vm.$nextTick()
    expect(el.getAttribute('aria-activedescendant')).toBe('event-search-results-option-0')

    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await wrapper!.vm.$nextTick()
    const emitted = wrapper!.emitted('select') as unknown[][]
    expect(emitted).toHaveLength(1)
    expect((emitted[0][0] as CalendarEvent).id).toBe('e3')
    // Enter closes the dropdown again.
    expect(document.body.querySelector('[role="listbox"]')).toBeNull()

    // Escape on a closed dropdown clears the query.
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await wrapper!.vm.$nextTick()
    expect(input().value).toBe('')
  })

  it('selects a result with the mouse and shows an empty state', async () => {
    mountSearch()
    const el = input()
    el.value = 'dentist'
    el.dispatchEvent(new Event('input'))
    await wrapper!.vm.$nextTick()

    options()[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await wrapper!.vm.$nextTick()
    expect(((wrapper!.emitted('select') as unknown[][])[0][0] as CalendarEvent).id).toBe('e2')

    el.value = 'zzzz'
    el.dispatchEvent(new Event('input'))
    await wrapper!.vm.$nextTick()
    expect(options()).toHaveLength(0)
    expect(document.body.textContent).toContain('No matching events in the loaded period.')
  })
})
