/**
 * eventPeople – read-only rendering helpers for `ORGANIZER` / `ATTENDEE`.
 *
 * The dialog shows participants exactly as the inviting client stored them, so
 * these helpers only decide *how* a person and their PARTSTAT are labelled. The
 * status label is returned as an English gettext key (the dialog wraps it in
 * `$gettext`), which keeps the translations in the gettext catalog
 * (`l10n/locale/<lang>/app.po`) instead of duplicating a status vocabulary here.
 */

import type { EventAttendee, EventOrganizer } from '../types'

export interface PersonLike {
  name?: string
  email: string
}

/** Participation status bucket used for CSS hooks (never colour-only: the
 *  status is always rendered as text as well). */
export type ParticipantStatus =
  'accepted' | 'declined' | 'tentative' | 'needs-action' | 'delegated' | 'unknown'

/** `CN` when the ICS carries one, otherwise the raw address. */
export function personLabel(person: PersonLike): string {
  const name = person.name?.trim()
  return name || person.email
}

/** Normalise a `PARTSTAT` parameter value (`needs-action`, `ACCEPTED`, …). */
export function participantStatus(partstat?: string): ParticipantStatus {
  switch ((partstat || '').trim().toUpperCase()) {
    case 'ACCEPTED':
      return 'accepted'
    case 'DECLINED':
      return 'declined'
    case 'TENTATIVE':
      return 'tentative'
    case 'NEEDS-ACTION':
      return 'needs-action'
    case 'DELEGATED':
      return 'delegated'
    default:
      return 'unknown'
  }
}

/**
 * Translated text of a participation status, or '' when the property carries no
 * PARTSTAT (a plain `ATTENDEE:mailto:…` or an ORGANIZER) — no badge is rendered
 * then. Literal `$gettext` calls so the extractor sees the strings.
 */
export function participantStatusLabel(
  partstat: string | undefined,
  $gettext: (text: string) => string
): string {
  switch (participantStatus(partstat)) {
    case 'accepted':
      return $gettext('Accepted')
    case 'declined':
      return $gettext('Declined')
    case 'tentative':
      return $gettext('Tentative')
    case 'needs-action':
      return $gettext('Needs action')
    case 'delegated':
      return $gettext('Delegated')
    default:
      return ''
  }
}

/**
 * Whether the dialog should render the participants block at all — hidden for
 * events that carry neither an ORGANIZER nor ATTENDEEs.
 */
export function hasParticipants(event: {
  organizer?: EventOrganizer
  attendees?: EventAttendee[]
}): boolean {
  return !!event.organizer || (event.attendees?.length ?? 0) > 0
}
