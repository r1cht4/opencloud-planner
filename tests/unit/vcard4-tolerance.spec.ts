import { describe, expect, it } from 'vitest'
import { parseVcard, patchVcard } from '../../src/composables/useContactsService'

// vCard 4.0 (RFC 6350) cards as produced by iOS/Google exports. We write 3.0
// but must READ 4.0 without mangling values.

const ios4Card = [
  'BEGIN:VCARD',
  'VERSION:4.0',
  'UID:urn:uuid:5cbe3e60-0001-4a4e-9d3b-000000000001',
  'FN:Nina Neumann',
  'N:Neumann;Nina;;;',
  'TEL;VALUE=uri;TYPE="CELL,VOICE":tel:+49-171-1234567',
  'TEL;TYPE=HOME,VOICE:tel:+49301234',
  'EMAIL;TYPE=work:nina@example.test',
  'PHOTO:data:image/jpeg;base64,/9j/FAKEBASE64',
  'BDAY:19850412',
  'GENDER:F',
  'IMPP;PREF=1:xmpp:nina@jabber.example',
  'END:VCARD'
].join('\r\n')

describe('vCard 4.0 read tolerance', () => {
  it('strips the tel: URI scheme from TEL values', () => {
    const c = parseVcard(ios4Card)
    expect(c.phones[0].value).toBe('+49-171-1234567')
    expect(c.phones[1].value).toBe('+49301234')
  })

  it('normalizes quoted and comma-separated TYPE parameters', () => {
    const c = parseVcard(ios4Card)
    expect(c.phones[0].type).toBe('cell')
    expect(c.phones[1].type).toBe('home')
    expect(c.emails[0].type).toBe('work')
  })

  it('reads 4.0 inline data-URI PHOTO', () => {
    const c = parseVcard(ios4Card)
    expect(c.photo).toBe('data:image/jpeg;base64,/9j/FAKEBASE64')
  })

  it('parses compact BDAY and keeps FN/N intact', () => {
    const c = parseVcard(ios4Card)
    expect(c.birthday).toBe('1985-04-12')
    expect(c.displayName).toBe('Nina Neumann')
  })

  it('normalizes the year-less BDAY form --MMDD without crashing', () => {
    const c = parseVcard(ios4Card.replace('BDAY:19850412', 'BDAY:--0412'))
    expect(c.birthday).toBe('--04-12')
  })

  it('drops the time part of a 4.0 BDAY date-time', () => {
    const c = parseVcard(ios4Card.replace('BDAY:19850412', 'BDAY:19850412T093000'))
    expect(c.birthday).toBe('1985-04-12')
  })

  it('preserves 4.0-only properties verbatim through patchVcard', () => {
    const c = parseVcard(ios4Card)
    c.displayName = 'Nina Neumann-Schulz'
    const patched = patchVcard(ios4Card, c)
    expect(patched).toContain('FN:Nina Neumann-Schulz')
    expect(patched).toContain('GENDER:F')
    expect(patched).toContain('IMPP;PREF=1:xmpp:nina@jabber.example')
  })
})
