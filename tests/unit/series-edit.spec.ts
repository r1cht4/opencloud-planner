/**
 * Regression tests for `src/ics/seriesEdit.ts`: editing or
 * dragging one occurrence of a recurring series with scope "entire series"
 * must shift the master by the same delta — and must leave the master's times
 * untouched when nothing moved.
 */
import { describe, expect, it } from 'vitest'
import { shiftSeriesTimes } from '../../src/ics/seriesEdit'

describe('shiftSeriesTimes — timed series', () => {
  const base = {
    masterStart: '2026-01-05 09:00',
    masterEnd: '2026-01-05 10:00',
    oldOccStart: '2026-11-23 09:00',
    isAllDay: false
  }

  it('title-only edit (unchanged times) leaves the master untouched', () => {
    const result = shiftSeriesTimes({
      ...base,
      newOccStart: '2026-11-23 09:00',
      newOccEnd: '2026-11-23 10:00'
    })
    expect(result).toEqual({ start: '2026-01-05 09:00', end: '2026-01-05 10:00', changed: false })
  })

  it('moving the occurrence +1h moves the master +1h and keeps the duration', () => {
    const result = shiftSeriesTimes({
      ...base,
      newOccStart: '2026-11-23 10:00',
      newOccEnd: '2026-11-23 11:00'
    })
    expect(result).toEqual({ start: '2026-01-05 10:00', end: '2026-01-05 11:00', changed: true })
  })

  it('moving the occurrence to another day shifts the master by whole days', () => {
    const result = shiftSeriesTimes({
      ...base,
      newOccStart: '2026-11-25 09:00',
      newOccEnd: '2026-11-25 10:00'
    })
    expect(result).toEqual({ start: '2026-01-07 09:00', end: '2026-01-07 10:00', changed: true })
  })

  it('resizing the occurrence stretches the master duration, not its start', () => {
    const result = shiftSeriesTimes({
      ...base,
      newOccStart: '2026-11-23 09:00',
      newOccEnd: '2026-11-23 11:30'
    })
    expect(result).toEqual({ start: '2026-01-05 09:00', end: '2026-01-05 11:30', changed: true })
  })

  it('a negative delta (earlier occurrence) moves the master back in time', () => {
    const result = shiftSeriesTimes({
      ...base,
      newOccStart: '2026-11-23 08:15',
      newOccEnd: '2026-11-23 09:15'
    })
    expect(result).toEqual({ start: '2026-01-05 08:15', end: '2026-01-05 09:15', changed: true })
  })

  it('shifting across a DST boundary keeps the wall-clock time (wall-clock delta)', () => {
    // Europe switches to winter time on 2026-10-25; a +1h wall-clock edit of the
    // 2026-11-23 occurrence must still be +1h on the master, not +1h absolute.
    const result = shiftSeriesTimes({
      masterStart: '2026-10-05 09:00',
      masterEnd: '2026-10-05 10:00',
      oldOccStart: '2026-11-23 09:00',
      newOccStart: '2026-11-23 10:00',
      newOccEnd: '2026-11-23 11:00',
      isAllDay: false
    })
    expect(result.start).toBe('2026-10-05 10:00')
    expect(result.end).toBe('2026-10-05 11:00')
  })
})

describe('shiftSeriesTimes — all-day series', () => {
  const base = {
    masterStart: '2026-01-05',
    masterEnd: '2026-01-06',
    oldOccStart: '2026-11-23',
    isAllDay: true
  }

  it('unchanged all-day occurrence leaves the master untouched', () => {
    const result = shiftSeriesTimes({
      ...base,
      newOccStart: '2026-11-23',
      newOccEnd: '2026-11-24'
    })
    expect(result).toEqual({ start: '2026-01-05', end: '2026-01-06', changed: false })
  })

  it('moving the all-day occurrence by 3 days shifts the master by 3 days', () => {
    const result = shiftSeriesTimes({
      ...base,
      newOccStart: '2026-11-26',
      newOccEnd: '2026-11-27'
    })
    expect(result).toEqual({ start: '2026-01-08', end: '2026-01-09', changed: true })
  })

  it('date-only values stay date-only (no time part appears)', () => {
    const result = shiftSeriesTimes({
      ...base,
      newOccStart: '2026-11-23',
      newOccEnd: '2026-11-25' // two-day all-day occurrence
    })
    expect(result.start).toBe('2026-01-05')
    expect(result.end).toBe('2026-01-07')
    expect(result.end).not.toContain(' ')
  })
})
