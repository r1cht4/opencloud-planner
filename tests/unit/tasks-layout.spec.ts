/**
 * Tasks view layout: the task list (`.task-scroll`) is a scrolling flex column,
 * and every group card clips its rows (`overflow: hidden` for the rounded
 * corners). Such a flex child may shrink below its content, so with many tasks
 * the groups were squeezed into the visible area and their rows cut off instead
 * of the list scrolling. happy-dom has no layout engine; the live check is in
 * `tests/e2e/tasks.smoke.spec.ts`, this pins the rule itself.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function rule(source: string, selector: string): string {
  const start = source.indexOf(`${selector} {`)
  expect(start, selector).toBeGreaterThan(-1)
  return source.slice(start, source.indexOf('}', start))
}

describe('Tasks view layout', () => {
  it('never shrinks a task group inside the scrolling list', () => {
    const source = readFileSync('src/views/Tasks.vue', 'utf8')

    const list = rule(source, '.task-scroll')
    expect(list).toContain('flex-direction: column')
    expect(list).toContain('overflow-y: auto')

    const group = rule(source, '.task-group')
    expect(group).toContain('overflow: hidden')
    expect(group).toContain('flex-shrink: 0')
  })
})
