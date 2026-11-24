/**
 * contactsCsv.ts – Google Contacts / Outlook CSV ↔ internal `Contact` model.
 *
 * Contacts are the one data class every other tool can export, but there was no
 * spreadsheet-friendly format. This module reads the two CSV flavours people
 * actually have (Google Contacts and Outlook — English, German and French
 * headers, comma or semicolon separated) into `Contact` objects, and writes a
 * Google-compatible CSV back out.
 *
 * Import is lossless in the sense that matters here: the CSV carries only the
 * fields we map; the resulting contacts are turned into fresh vCards by
 * `buildVcard` (existing vCards on the server are never touched — the PUT uses
 * `If-None-Match: *`, so an already-present UID is reported as "skipped").
 */

import type { Contact } from '../types'
import { parseCsv, toCsv } from './csv'

export type CsvFormat = 'google' | 'outlook' | 'unknown'

/**
 * What a CSV column holds. `email`…`email4` / `phone`…`phone4` are order slots:
 * every column mapped to one of them contributes an entry, so a file with
 * "Home Email" *and* "Work Email" ends up with two emails in column order.
 */
export type ContactCsvField =
  | 'ignore'
  | 'displayName'
  | 'firstName'
  | 'lastName'
  | 'organization'
  | 'title'
  | 'birthday'
  | 'notes'
  | 'email'
  | 'email2'
  | 'email3'
  | 'email4'
  | 'phone'
  | 'phone2'
  | 'phone3'
  | 'phone4'

export type CsvMapping = ContactCsvField[]

/** Selectable fields in the mapping UI, in display order. */
export const CONTACT_CSV_FIELDS: ContactCsvField[] = [
  'ignore',
  'displayName',
  'firstName',
  'lastName',
  'organization',
  'title',
  'birthday',
  'notes',
  'email',
  'email2',
  'email3',
  'email4',
  'phone',
  'phone2',
  'phone3',
  'phone4'
]

/**
 * Header label → field. Labels are compared lower-cased with collapsed spaces
 * and without accents-insensitive noise beyond that (the localisations we care
 * about differ by words, not diacritics we can strip safely).
 */
const HEADER_FIELDS: Record<string, ContactCsvField> = {
  // Names — Google
  name: 'displayName',
  'given name': 'firstName',
  'family name': 'lastName',
  // Names — Outlook (en / de / fr)
  'first name': 'firstName',
  'last name': 'lastName',
  vorname: 'firstName',
  nachname: 'lastName',
  prénom: 'firstName',
  nom: 'lastName',
  // Company / role
  organization: 'organization',
  organisation: 'organization',
  company: 'organization',
  unternehmen: 'organization',
  firma: 'organization',
  société: 'organization',
  'job title': 'title',
  title: 'title',
  berufsbezeichnung: 'title',
  fonction: 'title',
  // Misc
  birthday: 'birthday',
  geburtstag: 'birthday',
  anniversaire: 'birthday',
  notes: 'notes',
  notizen: 'notes',
  // Emails — Google "E-mail N - Value" columns
  'e-mail 1 - value': 'email',
  'e-mail 2 - value': 'email2',
  'e-mail 3 - value': 'email3',
  'e-mail 4 - value': 'email4',
  'email 1 - value': 'email',
  'email 2 - value': 'email2',
  // Emails — Outlook (en / de / fr)
  'primary email': 'email',
  'secondary email': 'email2',
  'e-mail address': 'email',
  'primäre e-mail-adresse': 'email',
  'sekundäre e-mail-adresse': 'email2',
  'home email': 'email',
  'work email': 'email2',
  'other email': 'email3',
  // Phones — Google "Phone N - Value"
  'phone 1 - value': 'phone',
  'phone 2 - value': 'phone2',
  'phone 3 - value': 'phone3',
  'phone 4 - value': 'phone4',
  // Phones — Outlook (en / de)
  'primary phone': 'phone',
  'secondary phone': 'phone2',
  'mobile phone': 'phone3',
  'home phone': 'phone',
  'home phone 2': 'phone2',
  'work phone': 'phone2',
  'work phone 2': 'phone3',
  'business phone': 'phone2',
  'primäre telefonnummer': 'phone',
  'sekundäre telefonnummer': 'phone2',
  handy: 'phone3',
  'geschäftliche telefonnummer': 'phone2',
  telefon: 'phone'
}

const GOOGLE_MARKERS = ['given name', 'family name', 'e-mail 1 - value']
const FIRST_NAME_LABELS = ['first name', 'given name', 'vorname', 'prénom', 'prenom']
const LAST_NAME_LABELS = ['last name', 'family name', 'nachname', 'nom']

/** Lower-case, trim, collapse inner whitespace — the comparison form of a header cell. */
function normalizeHeaderCell(cell: string): string {
  return (cell || '').replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * Which export produced this header.
 *
 * Google is identified by its characteristic triple (`Given Name`,
 * `Family Name`, `E-mail 1 - Value`); anything with a first-name *and* a
 * last-name column is treated as Outlook. Everything else is `unknown` — the
 * import dialog then shows the column → field mapping so the user can fix it.
 */
export function detectFormat(header: string[]): CsvFormat {
  const cells = header.map(normalizeHeaderCell)
  if (GOOGLE_MARKERS.every((marker) => cells.includes(marker))) return 'google'
  const hasFirst = cells.some((cell) => FIRST_NAME_LABELS.includes(cell))
  const hasLast = cells.some((cell) => LAST_NAME_LABELS.includes(cell))
  if (hasFirst && hasLast) return 'outlook'
  return 'unknown'
}

/** Derive a column → field mapping from the header row (unrecognised → `ignore`). */
export function mapHeaderToFields(header: string[]): CsvMapping {
  return header.map((cell) => HEADER_FIELDS[normalizeHeaderCell(cell)] ?? 'ignore')
}

/**
 * Map an ISO-ish date to the `YYYY-MM-DD` (or year-less `--MM-DD`) form the
 * `Contact` model and `buildVcard` expect. Accepts `YYYY-MM-DD`, `--MM-DD`,
 * US `M/D/YYYY` and German `D.M.YYYY`; anything else is dropped rather than
 * stored as an unusable BDAY.
 */
export function normalizeCsvBirthday(value: string): string | undefined {
  const raw = (value || '').trim()
  if (!raw) return undefined

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  if (iso) return raw

  const yearless = /^--(\d{2})-?(\d{2})$/.exec(raw)
  if (yearless) return `--${yearless[1]}-${yearless[2]}`

  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw)
  if (us) {
    return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`
  }

  const german = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(raw)
  if (german) {
    return `${german[3]}-${german[2].padStart(2, '0')}-${german[1].padStart(2, '0')}`
  }

  return undefined
}

function emailType(header: string[] | undefined, row: string[], column: number): string {
  const previous = header?.[column - 1] ? normalizeHeaderCell(header[column - 1]) : ''
  if (previous.endsWith('- type')) {
    const raw = (row[column - 1] || '').trim().toLowerCase()
    if (raw === 'home' || raw === 'privat') return 'home'
    if (raw === 'work' || raw === 'geschäftlich') return 'work'
    return 'other'
  }
  const label = normalizeHeaderCell(header?.[column] ?? '')
  if (label.includes('work') || label.includes('geschäft')) return 'work'
  if (label.includes('home') || label.includes('privat')) return 'home'
  return 'other'
}

function phoneType(header: string[] | undefined, row: string[], column: number): string {
  const previous = header?.[column - 1] ? normalizeHeaderCell(header[column - 1]) : ''
  const fromCell = (value: string): string | null => {
    const raw = value.trim().toLowerCase()
    if (!raw) return null
    if (raw.includes('mobile') || raw.includes('handy') || raw.includes('cell')) return 'cell'
    if (raw.includes('fax')) return 'fax'
    if (raw.includes('home') || raw.includes('privat')) return 'home'
    if (raw.includes('work') || raw.includes('business') || raw.includes('geschäft')) return 'work'
    return 'other'
  }

  if (previous.endsWith('- type')) {
    return fromCell(row[column - 1] || '') ?? 'other'
  }
  return fromCell(normalizeHeaderCell(header?.[column] ?? '')) ?? 'other'
}

/**
 * Build contacts from CSV data rows.
 *
 * `rows` must not include the header row (see `parseContactsCsv`); `header` is
 * optional and only used to derive email/phone types (Google writes a paired
 * `E-mail 1 - Type` column, Outlook encodes the type in the column label).
 * Rows without any name, email or phone are skipped — they carry nothing a
 * contact could show.
 */
export function csvRowsToContacts(
  rows: string[][],
  mapping: CsvMapping,
  header?: string[]
): Contact[] {
  const contacts: Contact[] = []

  for (const row of rows) {
    const contact: Contact = {
      id: crypto.randomUUID(),
      displayName: '',
      firstName: '',
      lastName: '',
      emails: [],
      phones: [],
      addresses: [],
      organization: '',
      title: '',
      notes: ''
    }

    for (let column = 0; column < mapping.length; column++) {
      const field = mapping[column]
      if (!field || field === 'ignore') continue
      const value = (row[column] ?? '').trim()
      if (!value) continue

      if (field.startsWith('email')) {
        contact.emails.push({ type: emailType(header, row, column), value })
      } else if (field.startsWith('phone')) {
        contact.phones.push({ type: phoneType(header, row, column), value })
      } else {
        switch (field) {
          case 'displayName':
            contact.displayName = value
            break
          case 'firstName':
            contact.firstName = value
            break
          case 'lastName':
            contact.lastName = value
            break
          case 'organization':
            contact.organization = value
            break
          case 'title':
            contact.title = value
            break
          case 'notes':
            contact.notes = value
            break
          case 'birthday': {
            const birthday = normalizeCsvBirthday(value)
            if (birthday) contact.birthday = birthday
            break
          }
        }
      }
    }

    if (!contact.displayName) {
      contact.displayName =
        [contact.firstName, contact.lastName].filter(Boolean).join(' ') ||
        contact.emails[0]?.value ||
        contact.phones[0]?.value ||
        ''
    }
    if (!contact.displayName) continue

    contacts.push(contact)
  }

  return contacts
}

/** Column layout of the CSV we write — Google Contacts accepts exactly these headers. */
const GOOGLE_CSV_HEADER: string[] = [
  'Name',
  'Given Name',
  'Family Name',
  'Organization',
  'Job Title',
  'Birthday',
  'Notes',
  'E-mail 1 - Type',
  'E-mail 1 - Value',
  'E-mail 2 - Type',
  'E-mail 2 - Value',
  'E-mail 3 - Type',
  'E-mail 3 - Value',
  'Phone 1 - Type',
  'Phone 1 - Value',
  'Phone 2 - Type',
  'Phone 2 - Value',
  'Phone 3 - Type',
  'Phone 3 - Value'
]

/** Google uses capitalised type words; our model uses lower-case keys. */
function googleEmailType(type: string): string {
  if (type === 'home') return 'Home'
  if (type === 'work') return 'Work'
  return 'Other'
}

function googlePhoneType(type: string): string {
  if (type === 'cell') return 'Mobile'
  if (type === 'home') return 'Home'
  if (type === 'work') return 'Work'
  if (type === 'fax') return 'Fax'
  return 'Other'
}

/**
 * Serialise contacts as a Google Contacts CSV (2.5 emails/phones per row is the
 * Google layout; we write the first three of each). Addresses and photos are not
 * part of the CSV — the .vcf export/backup remains the lossless path.
 */
export function contactsToGoogleCsv(contacts: Contact[]): string {
  const rows: string[][] = [GOOGLE_CSV_HEADER]

  for (const contact of contacts) {
    const row: string[] = [
      contact.displayName,
      contact.firstName,
      contact.lastName,
      contact.organization,
      contact.title,
      contact.birthday ?? '',
      contact.notes
    ]
    for (let i = 0; i < 3; i++) {
      const email = contact.emails[i]
      row.push(email ? googleEmailType(email.type) : '', email?.value ?? '')
    }
    for (let i = 0; i < 3; i++) {
      const phone = contact.phones[i]
      row.push(phone ? googlePhoneType(phone.type) : '', phone?.value ?? '')
    }
    rows.push(row)
  }

  return toCsv(rows)
}

export interface ParsedContactsCsv {
  /** Detected export flavour — `unknown` means the user should map the columns. */
  format: CsvFormat
  /** Header row as found in the file (already unquoted/BOM-stripped). */
  header: string[]
  /** Column → field mapping used for `contacts` (derived unless passed in). */
  mapping: CsvMapping
  contacts: Contact[]
}

/**
 * Parse a contacts CSV file: sniff/parse, detect the flavour, map the columns and
 * build contacts. A `mapping` (from the mapping UI) overrides the derived one.
 * The first row is always treated as the header — every export we support has one.
 */
export function parseContactsCsv(text: string, mapping?: CsvMapping): ParsedContactsCsv {
  const rows = parseCsv(text)
  const header = rows[0] ?? []
  const fields = mapping && mapping.length ? mapping : mapHeaderToFields(header)
  return {
    format: detectFormat(header),
    header,
    mapping: fields,
    contacts: csvRowsToContacts(rows.slice(1), fields, header)
  }
}
