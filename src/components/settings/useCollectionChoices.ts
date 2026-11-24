/**
 * Collection choices for the Settings sections.
 *
 * `calendar.defaultCalendar`, `tasks.defaultCalendar`, `contacts.defaultAddressBook`
 * and `birthdays.calendar` all store a collection **URL**, so the sections need the
 * real list to build their selects. Loading it here keeps the four components free
 * of DAV details and gives them the same "unreachable server → empty list, no
 * error" behaviour as the rest of the settings page (the connection gate tells the
 * user what is wrong, a select does not).
 */

import { onMounted, ref, type Ref } from 'vue'
import { useCalendarService } from '../../composables/useCalendarService'
import { useContactsService } from '../../composables/useContactsService'
import { useDAVClient } from '../../composables/useDAVClient'

export interface CollectionChoice {
  url: string
  displayName: string
}

const EMPTY: CollectionChoice[] = []

function toChoices(collections: Array<{ url: string; displayName: string }>): CollectionChoice[] {
  return collections.map((collection) => ({
    url: collection.url,
    displayName: collection.displayName
  }))
}

/** Calendars of the user (empty while loading or when DAV is unreachable). */
export function useCalendarChoices(): { choices: Ref<CollectionChoice[]> } {
  const choices = ref<CollectionChoice[]>(EMPTY)
  const { ensureReady } = useDAVClient()
  const { fetchCalendars } = useCalendarService()

  onMounted(async () => {
    try {
      if (!(await ensureReady('calendar'))) return
      choices.value = toChoices(await fetchCalendars())
    } catch {
      // A missing list only means the select shows no collections — the
      // connection gate/status explains why.
    }
  })

  return { choices }
}

/** Address books of the user (empty while loading or when DAV is unreachable). */
export function useAddressBookChoices(): { choices: Ref<CollectionChoice[]> } {
  const choices = ref<CollectionChoice[]>(EMPTY)
  const { ensureReady } = useDAVClient()
  const { fetchAddressBooks } = useContactsService()

  onMounted(async () => {
    try {
      if (!(await ensureReady('contacts'))) return
      choices.value = toChoices(await fetchAddressBooks())
    } catch {
      /* see useCalendarChoices */
    }
  })

  return { choices }
}
