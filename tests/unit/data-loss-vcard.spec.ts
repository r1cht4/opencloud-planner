import { describe, expect, it } from 'vitest'
import { buildVcard, parseVcard, patchVcard } from '../../src/composables/useContactsService'

const RAW_WITH_CUSTOM = [
  'BEGIN:VCARD',
  'VERSION:3.0',
  'UID:test-uid-42',
  'FN:Jane Doe',
  'N:Doe;Jane;;;',
  'EMAIL;TYPE=work:jane@example.com',
  'IMPP;TYPE=work:xmpp:user@example.com',
  'X-SOCIALPROFILE;TYPE=twitter:https://twitter.com/user',
  'X-CUSTOM-FIELD:keepme',
  'END:VCARD'
].join('\r\n')

describe('patchVcard – data-loss prevention', () => {
  it('updates managed properties while preserving unmanaged custom lines', () => {
    const contact = parseVcard(RAW_WITH_CUSTOM)

    // Simulate edits from the UI
    contact.displayName = 'Jane Smith'
    contact.emails = [{ type: 'work', value: 'jsmith@example.com' }]

    const patched = patchVcard(RAW_WITH_CUSTOM, contact)

    // Managed properties reflect the edits
    expect(patched).toContain('FN:Jane Smith')
    expect(patched).toContain('EMAIL;TYPE=work:jsmith@example.com')

    // UID is unchanged
    expect(patched).toContain('UID:test-uid-42')

    // Unmanaged / custom properties are preserved verbatim
    expect(patched).toContain('IMPP;TYPE=work:xmpp:user@example.com')
    expect(patched).toContain('X-SOCIALPROFILE;TYPE=twitter:https://twitter.com/user')
    expect(patched).toContain('X-CUSTOM-FIELD:keepme')

    // A REV timestamp is present
    expect(patched).toMatch(/\r\nREV:\d{8}T\d{6}Z\r\n/)

    // Structural integrity
    expect(patched.startsWith('BEGIN:VCARD\r\nVERSION:3.0\r\n')).toBe(true)
    expect(patched.endsWith('\r\nEND:VCARD')).toBe(true)
  })

  it('round-trips multiple addresses when patching a contact', () => {
    const raw = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      'UID:multi-address',
      'FN:Multi Address',
      'N:Address;Multi;;;',
      'ADR;TYPE=home:;;Home Street 1;Berlin;BE;10115;Germany',
      'ADR;TYPE=work:;;Office Street 2;Hamburg;HH;20095;Germany',
      'END:VCARD'
    ].join('\r\n')

    const contact = parseVcard(raw)
    expect(contact.addresses).toHaveLength(2)

    contact.addresses[1].city = 'Munich'
    const patched = patchVcard(raw, contact)

    expect(patched).toContain('ADR;TYPE=home:;;Home Street 1;Berlin;BE;10115;Germany')
    expect(patched).toContain('ADR;TYPE=work:;;Office Street 2;Munich;HH;20095;Germany')

    const reparsed = parseVcard(patched)
    expect(reparsed.addresses).toEqual([
      {
        type: 'home',
        street: 'Home Street 1',
        city: 'Berlin',
        region: 'BE',
        postalCode: '10115',
        country: 'Germany'
      },
      {
        type: 'work',
        street: 'Office Street 2',
        city: 'Munich',
        region: 'HH',
        postalCode: '20095',
        country: 'Germany'
      }
    ])
  })

  it('does not emit a grouped managed property twice (Apple item groups)', () => {
    // Apple writes `item1.EMAIL:…`; before the group prefix was stripped on
    // patch, the model produced no EMAIL at all and the original line survived
    // as "unmanaged". Now the prefix is understood, so the entry must be written
    // exactly once — either reused verbatim (unchanged) or rebuilt (changed).
    const raw = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      'UID:grouped-managed',
      'FN:Grouped Person',
      'N:Person;Grouped;;;',
      'item1.EMAIL;type=INTERNET:grouped@example.org',
      'item1.X-ABLabel:Work',
      'item2.TEL:+491234',
      'item2.X-ABLabel:Mobile',
      'IMPP;TYPE=work:xmpp:grouped@example.org',
      'END:VCARD'
    ].join('\r\n')

    const unchanged = parseVcard(raw)
    const sameCard = patchVcard(raw, unchanged)
    expect(sameCard.split('\r\n').filter((line) => /^(item\d+\.)?EMAIL/i.test(line))).toHaveLength(
      1
    )
    expect(sameCard.split('\r\n').filter((line) => /^(item\d+\.)?TEL/i.test(line))).toHaveLength(1)
    expect(sameCard).toContain('item1.X-ABLabel:Work')
    expect(sameCard).toContain('IMPP;TYPE=work:xmpp:grouped@example.org')

    const edited = parseVcard(raw)
    edited.emails = [{ type: 'internet', value: 'changed@example.org' }]
    const changedCard = patchVcard(raw, edited)
    const emailLines = changedCard.split('\r\n').filter((line) => /^(item\d+\.)?EMAIL/i.test(line))
    expect(emailLines).toHaveLength(1)
    expect(emailLines[0]).toContain('changed@example.org')
    // IMPP still carries the old address (unmanaged) — only the EMAIL line changed.
    expect(changedCard).toContain('IMPP;TYPE=work:xmpp:grouped@example.org')
  })
})

describe('buildVcard – REV timestamp', () => {
  it('includes a REV line in the vCard output for new contacts', () => {
    const contact = parseVcard(RAW_WITH_CUSTOM)
    const built = buildVcard(contact)

    expect(built).toMatch(/\r\nREV:\d{8}T\d{6}Z\r\n/)
    // Sanity-check that other properties are still present
    expect(built).toContain('FN:Jane Doe')
    expect(built).toContain('UID:test-uid-42')
  })
})
