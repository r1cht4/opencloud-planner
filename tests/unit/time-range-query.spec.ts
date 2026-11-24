import { describe, expect, it } from 'vitest'
import { buildCalendarQueryBody } from '../../src/composables/useCalendarService'

describe('buildCalendarQueryBody', () => {
  it('omits time-range when no range is given (full fetch)', () => {
    const body = buildCalendarQueryBody()
    expect(body).toContain('<c:comp-filter name="VEVENT"/>')
    expect(body).not.toContain('time-range')
  })

  it('emits a UTC time-range filter inside the VEVENT comp-filter', () => {
    const body = buildCalendarQueryBody({
      start: new Date(Date.UTC(2026, 0, 1)),
      end: new Date(Date.UTC(2027, 0, 1))
    })
    expect(body).toContain('<c:comp-filter name="VEVENT">')
    expect(body).toContain('<c:time-range start="20260101T000000Z" end="20270101T000000Z"/>')
    expect(body).toContain('</c:comp-filter>')
  })

  it('formats non-midnight instants correctly', () => {
    const body = buildCalendarQueryBody({
      start: new Date(Date.UTC(2026, 6, 18, 9, 30, 5)),
      end: new Date(Date.UTC(2026, 11, 31, 23, 59, 59))
    })
    expect(body).toContain('start="20260718T093005Z"')
    expect(body).toContain('end="20261231T235959Z"')
  })
})
