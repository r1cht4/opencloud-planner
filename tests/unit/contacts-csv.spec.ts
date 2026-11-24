import { describe, expect, it } from 'vitest'
import { detectDelimiter, parseCsv, toCsv } from '../../src/tools/csv'
import {
  contactsToGoogleCsv,
  csvRowsToContacts,
  detectFormat,
  mapHeaderToFields,
  normalizeCsvBirthday,
  parseContactsCsv
} from '../../src/tools/contactsCsv'
import type { Contact } from '../../src/types'

import { GOOGLE_CSV, OUTLOOK_DE_CSV } from './fixtures/contacts-csv'

describe('parseCsv', () => {
  it('BOM stripped', () => {
    const rows = parseCsv(`\uFEFF${GOOGLE_CSV}`)
    expect(rows[0][0]).toBe('Name')
    expect(rows).toHaveLength(2)
  })

  it('quoted comma and newline kept', () => {
    const rows = parseCsv('Name,Notes\r\n"Weber, Maria","Line one\r\nLine two"\r\n')
    expect(rows[1][0]).toBe('Weber, Maria')
    expect(rows[1][1]).toBe('Line one\nLine two')
  })

  it('doubled quotes are unescaped and round-trip through toCsv', () => {
    const rows = [['Name'], ['Say "hi"']]
    expect(parseCsv(toCsv(rows))).toEqual(rows)
  })

  it('sniffs the semicolon and tab delimiters', () => {
    expect(detectDelimiter(OUTLOOK_DE_CSV)).toBe(';')
    expect(detectDelimiter('a\tb\tc')).toBe('\t')
    expect(detectDelimiter(GOOGLE_CSV)).toBe(',')
  })

  it('ignores delimiters inside quotes when sniffing', () => {
    expect(parseCsv('"a;b";c')[0]).toEqual(['a;b', 'c'])
  })
})

describe('detectFormat', () => {
  it('Google header detected', () => {
    expect(detectFormat(parseCsv(GOOGLE_CSV)[0])).toBe('google')
  })

  it("Outlook German header with ';' detected", () => {
    const rows = parseCsv(OUTLOOK_DE_CSV)
    expect(rows[0]).toEqual([
      'Vorname',
      'Nachname',
      'Primäre E-Mail-Adresse',
      'Primäre Telefonnummer',
      'Geburtstag'
    ])
    expect(detectFormat(rows[0])).toBe('outlook')
  })

  it('strips a BOM from a semicolon-separated Outlook export', () => {
    const { format, contacts } = parseContactsCsv(`\uFEFF${OUTLOOK_DE_CSV}`)

    expect(format).toBe('outlook')
    expect(contacts).toHaveLength(1)
    expect(contacts[0].displayName).toBe('Jürgen Müller')
  })

  it('unknown headers stay unknown', () => {
    expect(detectFormat(['col1', 'col2'])).toBe('unknown')
  })
})

describe('csvRowsToContacts', () => {
  it('Google multi-email/phone columns mapped', () => {
    const { format, contacts } = parseContactsCsv(GOOGLE_CSV)

    expect(format).toBe('google')
    expect(contacts).toHaveLength(1)
    expect(contacts[0]).toMatchObject({
      displayName: 'Maria Weber',
      firstName: 'Maria',
      lastName: 'Weber',
      birthday: '1990-05-04',
      notes: 'Likes tea'
    })
    expect(contacts[0].emails).toEqual([
      { type: 'home', value: 'maria@example.com' },
      { type: 'work', value: 'maria.weber@work.example' }
    ])
    expect(contacts[0].phones).toEqual([
      { type: 'cell', value: '+49 170 1234567' },
      { type: 'home', value: '+49 30 123456' }
    ])
  })

  it('reads a German Outlook export (semicolons, localised headers, German date)', () => {
    const { format, contacts } = parseContactsCsv(OUTLOOK_DE_CSV)

    expect(format).toBe('outlook')
    expect(contacts).toHaveLength(1)
    expect(contacts[0]).toMatchObject({
      displayName: 'Jürgen Müller',
      firstName: 'Jürgen',
      lastName: 'Müller',
      birthday: '1990-05-04'
    })
    expect(contacts[0].emails).toEqual([{ type: 'other', value: 'j.mueller@example.de' }])
    expect(contacts[0].phones).toEqual([{ type: 'other', value: '+49 89 12345' }])
  })

  it('maps columns from a user-supplied mapping for unknown headers', () => {
    const header = ['Spalte A', 'Spalte B', 'Spalte C']
    expect(mapHeaderToFields(header)).toEqual(['ignore', 'ignore', 'ignore'])

    const contacts = csvRowsToContacts(
      [['Anna Schmidt', 'anna@example.com', '1991-01-02']],
      ['displayName', 'email', 'birthday'],
      header
    )

    expect(contacts).toHaveLength(1)
    expect(contacts[0].displayName).toBe('Anna Schmidt')
    expect(contacts[0].emails).toEqual([{ type: 'other', value: 'anna@example.com' }])
    expect(contacts[0].birthday).toBe('1991-01-02')
  })

  it('skips rows without a name, email or phone', () => {
    const contacts = csvRowsToContacts(
      [
        ['', '', ''],
        ['Bob', '', '']
      ],
      ['displayName', 'email', 'phone']
    )
    expect(contacts.map((c) => c.displayName)).toEqual(['Bob'])
  })

  it('normalises the birthday formats seen in exports', () => {
    expect(normalizeCsvBirthday('1990-05-04')).toBe('1990-05-04')
    expect(normalizeCsvBirthday('--05-04')).toBe('--05-04')
    expect(normalizeCsvBirthday('5/4/1990')).toBe('1990-05-04')
    expect(normalizeCsvBirthday('04.05.1990')).toBe('1990-05-04')
    expect(normalizeCsvBirthday('someday')).toBeUndefined()
  })
})

describe('contactsToGoogleCsv', () => {
  const contact: Contact = {
    id: 'maria-1',
    displayName: 'Maria Weber',
    firstName: 'Maria',
    lastName: 'Weber',
    emails: [
      { type: 'home', value: 'maria@example.com' },
      { type: 'work', value: 'maria.weber@work.example' }
    ],
    phones: [
      { type: 'cell', value: '+49 170 1234567' },
      { type: 'home', value: '+49 30 123456' }
    ],
    addresses: [],
    organization: 'Example GmbH',
    title: 'Developer',
    notes: 'Likes tea',
    birthday: '1990-05-04'
  }

  it('export → import roundtrip keeps name/emails/phones/birthday', () => {
    const csv = contactsToGoogleCsv([contact])
    const { format, contacts } = parseContactsCsv(csv)

    expect(format).toBe('google')
    expect(contacts).toHaveLength(1)
    expect(contacts[0]).toMatchObject({
      displayName: 'Maria Weber',
      firstName: 'Maria',
      lastName: 'Weber',
      organization: 'Example GmbH',
      title: 'Developer',
      notes: 'Likes tea',
      birthday: '1990-05-04'
    })
    expect(contacts[0].emails).toEqual(contact.emails)
    expect(contacts[0].phones).toEqual(contact.phones)
  })

  it('quotes values that contain a comma or a line break', () => {
    const csv = contactsToGoogleCsv([
      { ...contact, displayName: 'Weber, Maria', notes: 'Line one\nLine two' }
    ])
    const { contacts } = parseContactsCsv(csv)

    expect(contacts[0].displayName).toBe('Weber, Maria')
    expect(contacts[0].notes).toBe('Line one\nLine two')
  })
})
