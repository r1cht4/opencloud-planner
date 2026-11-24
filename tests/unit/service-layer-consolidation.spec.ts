/**
 * Consolidation guard for the service layer.
 *
 * The pure ICS/vCard code now lives in `src/ics/**` and `src/vcard/**`; the
 * composables re-export it so every existing importer (views, settings, other
 * modules, the specs) keeps using the old module path. This spec pins that
 * contract: the old path must expose the very same function objects, not a
 * parallel copy, and the single colour normaliser must stay the one all three
 * wrappers use.
 */
import { describe, expect, it } from 'vitest'

import {
  addExdateToIcs,
  buildIcs,
  expandRecurringEvents,
  formatDate,
  formatDateTime,
  getLocalTimeZone,
  normalizeDavColor,
  parseIcsToEvent,
  patchIcs,
  upsertRecurrenceOverrideIcs,
  zonedWallClockToDate
} from '../../src/composables/useCalendarService'
import {
  addExdateToIcs as icsPatchAddExdate,
  buildIcs as icsPatchBuildIcs,
  patchIcs as icsPatchPatchIcs,
  upsertRecurrenceOverrideIcs as icsPatchUpsert
} from '../../src/ics/icsPatch'
import { parseIcsToEvent as veventParse } from '../../src/ics/vevent'
import { expandRecurringEvents as recurrenceExpand } from '../../src/ics/recurrence'
import {
  formatDate as datetimeFormatDate,
  formatDateTime as datetimeFormatDateTime,
  getLocalTimeZone as datetimeLocalTimeZone,
  zonedWallClockToDate as datetimeZoned
} from '../../src/ics/datetime'

import {
  buildTodoIcs,
  filterTasks,
  isTaskDone,
  parseVtodoToTask,
  patchTodoIcs,
  setTodoCompletedIcs,
  sortTasks,
  supportsTasks,
  useTasksService
} from '../../src/composables/useTasksService'
import {
  buildTodoIcs as vtodoBuild,
  parseVtodoToTask as vtodoParse,
  patchTodoIcs as vtodoPatch,
  setTodoCompletedIcs as vtodoCompleted
} from '../../src/ics/vtodo'

import {
  buildVcard,
  escapeVcardText,
  parseVcard,
  safePhotoSrc,
  unescapeVcardText,
  patchVcard,
  useContactsService
} from '../../src/composables/useContactsService'
import {
  buildVcard as vcardBuild,
  parseVcard as vcardParse,
  patchVcard as vcardPatch
} from '../../src/vcard/vcard'

import type { Task } from '../../src/types'
import { normalizeColor } from '../../src/composables/colorUtils'
import { normalizeHexColor } from '../../src/composables/useCollections'

describe('re-exports keep the old module paths working', () => {
  it('re-exports the event ICS helpers from useCalendarService', () => {
    expect(buildIcs).toBe(icsPatchBuildIcs)
    expect(patchIcs).toBe(icsPatchPatchIcs)
    expect(addExdateToIcs).toBe(icsPatchAddExdate)
    expect(upsertRecurrenceOverrideIcs).toBe(icsPatchUpsert)
    expect(parseIcsToEvent).toBe(veventParse)
    expect(expandRecurringEvents).toBe(recurrenceExpand)
    expect(formatDate).toBe(datetimeFormatDate)
    expect(formatDateTime).toBe(datetimeFormatDateTime)
    expect(getLocalTimeZone).toBe(datetimeLocalTimeZone)
    expect(zonedWallClockToDate).toBe(datetimeZoned)
  })

  it('re-exports the VTODO helpers from useTasksService', () => {
    expect(buildTodoIcs).toBe(vtodoBuild)
    expect(parseVtodoToTask).toBe(vtodoParse)
    expect(patchTodoIcs).toBe(vtodoPatch)
    expect(setTodoCompletedIcs).toBe(vtodoCompleted)
    // The list shaping helpers are still reachable, and the composable still has
    // its DAV/state surface.
    expect(filterTasks([], 'open')).toEqual([])
    expect(isTaskDone({ status: 'COMPLETED' } as Task)).toBe(true)
    expect(sortTasks([])).toEqual([])
    expect(typeof supportsTasks).toBe('function')
    expect(typeof useTasksService).toBe('function')
  })

  it('re-exports the vCard helpers from useContactsService', () => {
    expect(buildVcard).toBe(vcardBuild)
    expect(parseVcard).toBe(vcardParse)
    expect(patchVcard).toBe(vcardPatch)
    expect(typeof escapeVcardText).toBe('function')
    expect(typeof unescapeVcardText).toBe('function')
    expect(typeof safePhotoSrc).toBe('function')
    expect(typeof useContactsService).toBe('function')
  })
})

describe('one colour normaliser', () => {
  it('is the implementation behind normalizeDavColor and normalizeHexColor', () => {
    // Same parsing, different documented contract: the calendar service keeps
    // upper case + a default, the collection manager upper case + null.
    expect(normalizeColor('#abc')).toBe('#aabbcc')
    expect(normalizeDavColor('#abc')).toBe('#AABBCC')
    expect(normalizeHexColor('#abc')).toBe('#AABBCC')

    expect(normalizeColor('#E5484DFF')).toBe('#e5484d')
    expect(normalizeDavColor('#E5484DFF')).toBe('#E5484D')
    expect(normalizeHexColor('#E5484DFF')).toBe('#E5484D')

    // Fallbacks stay where they were.
    expect(normalizeColor('rebeccapurple')).toBeNull()
    expect(normalizeDavColor('rebeccapurple')).toBe('#00677F')
    expect(normalizeHexColor('rebeccapurple')).toBeNull()
  })
})
