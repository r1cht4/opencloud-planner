// @vitest-environment happy-dom
/**
 * vCard data fidelity.
 *
 *  - year-less birthdays (`--0415`, Apple's `X-APPLE-OMIT-YEAR`) must
 *    round-trip instead of being corrupted to `BDAY:0415` on every save.
 *  - unchanged ungrouped EMAIL/TEL/ADR lines are reused verbatim
 *    (PREF, multi-TYPE, VALUE=uri survive an unrelated edit).
 *  - the original VERSION line is kept — a vCard 4.0 no longer becomes a
 *    3.0 header around 4.0 content.
 */
import { describe, expect, it } from 'vitest'
import { buildVcard, parseVcard, patchVcard } from '../../src/vcard/vcard'

const CRLF = '\r\n'

function vcard(lines: string[]): string {
  return [...lines, ''].join(CRLF)
}

function contact(raw: string) {
  const parsed = parseVcard(raw)
  return { parsed, raw }
}

describe('year-less birthday round-trip', () => {
  const YEAR_LESS = vcard([
    'BEGIN:VCARD',
    'VERSION:3.0',
    'UID:yearless-1',
    'FN:Bettina Yearless',
    'N:Yearless;Bettina;;;',
    'BDAY:--0415',
    'END:VCARD'
  ])

  it('parses --0415 into a year-less model value', () => {
    const { parsed } = contact(YEAR_LESS)
    expect(parsed.birthday).toBe('--04-15')
  })

  it('serialises a year-less birthday back to --MMDD (not 0415)', () => {
    const { parsed } = contact(YEAR_LESS)
    // Only the display name changes — the edit must not corrupt the birthday.
    const next = patchVcard(YEAR_LESS, { ...parsed, displayName: 'Bettina Y.' })

    expect(next).toContain('BDAY:--0415')
    expect(next).not.toMatch(/^BDAY:0415/m)
    expect(parseVcard(next).birthday).toBe('--04-15')
  })

  it('parses and keeps verbatim an Apple X-APPLE-OMIT-YEAR birthday', () => {
    const apple = vcard([
      'BEGIN:VCARD',
      'VERSION:3.0',
      'UID:apple-1',
      'FN:Ann Apple',
      'N:Apple;Ann;;;',
      'BDAY;X-APPLE-OMIT-YEAR=1604:1604-04-15',
      'END:VCARD'
    ])

    const { parsed } = contact(apple)
    expect(parsed.birthday).toBe('--04-15')

    const next = patchVcard(apple, { ...parsed, displayName: 'Ann A.' })
    // The original line survives byte-for-byte (params included).
    expect(next).toContain('BDAY;X-APPLE-OMIT-YEAR=1604:1604-04-15')
  })

  it('a changed birthday is written in the file version syntax', () => {
    const { parsed } = contact(YEAR_LESS)
    const next = patchVcard(YEAR_LESS, { ...parsed, birthday: '1985-04-15' })

    expect(next).toContain('BDAY:19850415')
  })

  it('parses the padded date and date-time forms exactly like vCard 4.0 does', () => {
    expect(
      parseVcard(vcard(['BEGIN:VCARD', 'VERSION:3.0', 'BDAY:19850415', 'END:VCARD'])).birthday
    ).toBe('1985-04-15')
    expect(
      parseVcard(vcard(['BEGIN:VCARD', 'VERSION:4.0', 'BDAY:1985-04-15T00:00:00Z', 'END:VCARD']))
        .birthday
    ).toBe('1985-04-15')
    // vCard 4.0 writes year-less dates natively as --MMDD.
    expect(
      parseVcard(vcard(['BEGIN:VCARD', 'VERSION:4.0', 'BDAY:--0415', 'END:VCARD'])).birthday
    ).toBe('--04-15')
  })
})

describe('unchanged ungrouped lines are reused verbatim', () => {
  const RICH = vcard([
    'BEGIN:VCARD',
    'VERSION:3.0',
    'UID:rich-1',
    'FN:Rich Richter',
    'N:Richter;Rich;;;',
    'TEL;TYPE=CELL,VOICE;PREF=1:+491701234567',
    'EMAIL;TYPE=work,home;PREF=1:rich@example.org',
    'TEL;VALUE=uri:tel:+493012345678',
    'item1.ADR;TYPE=work:;;Musterstr. 1;Berlin;;12345;Germany',
    'item1.X-ABLabel:Arbeit',
    'END:VCARD'
  ])

  it('keeps PREF, multi-TYPE and VALUE=uri through an edit of the name', () => {
    const { parsed } = contact(RICH)
    const next = patchVcard(RICH, { ...parsed, displayName: 'Rich R.' })

    expect(next).toContain('TEL;TYPE=CELL,VOICE;PREF=1:+491701234567')
    expect(next).toContain('EMAIL;TYPE=work,home;PREF=1:rich@example.org')
    expect(next).toContain('TEL;VALUE=uri:tel:+493012345678')
    // One line each, never rebuilt duplicates.
    expect(next.match(/^TEL/gm)).toHaveLength(2)
  })

  it('still reuses Apple grouped lines (regression of the item-group logic)', () => {
    const { parsed } = contact(RICH)
    const next = patchVcard(RICH, { ...parsed, displayName: 'Rich R.' })

    expect(next).toContain('item1.ADR;TYPE=work:;;Musterstr. 1;Berlin;;12345;Germany')
    expect(next).toContain('item1.X-ABLabel:Arbeit')
  })

  it('a changed phone value is rebuilt from the model', () => {
    const { parsed } = contact(RICH)
    const next = patchVcard(RICH, {
      ...parsed,
      phones: [{ type: 'cell', value: '+491709999999' }]
    })

    expect(next).toContain('TEL;TYPE=cell:+491709999999')
    expect(next).not.toContain('+491701234567')
  })
})

describe('the original VERSION line survives a patch', () => {
  const V4 = vcard([
    'BEGIN:VCARD',
    'VERSION:4.0',
    'UID:four-1',
    'FN:Vera Vier',
    'N:Vier;Vera;;;',
    'KIND:individual',
    'BDAY:--0415',
    'END:VCARD'
  ])

  it('keeps VERSION:4.0 (a 4.0 body must not become a 3.0 header)', () => {
    const { parsed } = contact(V4)
    const next = patchVcard(V4, { ...parsed, displayName: 'Vera V.' })

    expect(next).toContain('VERSION:4.0')
    expect(next).not.toContain('VERSION:3.0')
    // Unmanaged 4.0 content is still preserved verbatim.
    expect(next).toContain('KIND:individual')
    // vCard 4.0 natively writes the reduced date `--MMDD`.
    expect(next).toContain('BDAY:--0415')
  })

  it('a vCard 3.0 keeps VERSION:3.0 and the 3.0 photo encoding', () => {
    const v3 = vcard([
      'BEGIN:VCARD',
      'VERSION:3.0',
      'UID:three-1',
      'FN:Theo Drei',
      'N:Drei;Theo;;;',
      'END:VCARD'
    ])
    const { parsed } = contact(v3)
    const next = patchVcard(v3, {
      ...parsed,
      displayName: 'Theo D.',
      photo: 'data:image/png;base64,aGVsbG8='
    })

    expect(next).toContain('VERSION:3.0')
    expect(next).toContain('PHOTO;ENCODING=b;TYPE=PNG:aGVsbG8=')
  })

  it('a vCard 4.0 photo is written as the 4.0 data-URI form', () => {
    const { parsed } = contact(V4)
    const next = patchVcard(V4, {
      ...parsed,
      displayName: 'Vera V.',
      photo: 'data:image/png;base64,aGVsbG8='
    })

    expect(next).toContain('PHOTO:data:image/png;base64,aGVsbG8=')
    expect(next).not.toContain('ENCODING=b')
  })

  it('buildVcard (new contacts) still writes VERSION:3.0', () => {
    const vcard = buildVcard({
      id: 'new-1',
      displayName: 'Neu N.',
      firstName: 'Neu',
      lastName: 'N.',
      emails: [],
      phones: [],
      addresses: [],
      organization: '',
      title: '',
      notes: ''
    })
    expect(vcard).toContain('VERSION:3.0')
  })
})
