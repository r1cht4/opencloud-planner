/**
 * contactAvatar – the round monogram a contact gets in the list and on the
 * detail card: up to two initials plus a stable background colour derived from
 * the display name.
 *
 * Shared by `useContactsView` (the list) and `ContactDetail.vue`, so the same
 * contact looks the same in both places.
 */

/**
 * Background palette of the monogram. Mid-tone colours only, so the white
 * initials stay readable on every entry; the first entry is the OpenCloud
 * primary.
 */
const AVATAR_COLORS = [
  '#00677F',
  '#20434F',
  '#5A5C7E',
  '#715289',
  '#BA1A1A',
  '#3B82F6',
  '#10B981',
  '#F59E0B'
]

/** At most two initials from a display name (`Maria Weber` → `MW`). */
export function contactInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((w) => w.charAt(0))
    .join('')
    .toUpperCase()
}

/** Stable background colour of the monogram: the same name always gets the same one. */
export function avatarColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}
