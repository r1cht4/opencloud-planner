import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The calendar grid is unstyled without @event-calendar's own stylesheet (a view split
 * once dropped the import). Our overrides must load after it to win on equal specificity.
 */
describe('Calendar view stylesheets', () => {
  it('imports the @event-calendar stylesheet before our grid overrides', () => {
    const source = readFileSync('src/views/Calendar.vue', 'utf8')
    const base = source.indexOf("import '@event-calendar/core/index.css'")
    const overrides = source.indexOf("import '../styles/calendar-grid.css'")
    expect(base).toBeGreaterThan(-1)
    expect(overrides).toBeGreaterThan(base)
  })
})
