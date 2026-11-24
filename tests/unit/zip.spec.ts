import { describe, expect, it } from 'vitest'
import { crc32, createZip, readZip } from '../../src/tools/zip'

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8')

function bytes(text: string): Uint8Array {
  return encoder.encode(text)
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/**
 * Hand-rolled single-entry archive — deliberately independent of `createZip` so
 * the reader is tested against bytes it did not produce itself.
 */
function buildEntryZip(options: {
  name: string
  raw: Uint8Array
  payload: Uint8Array
  method: number
  flags?: number
}): ArrayBuffer {
  const nameBytes = encoder.encode(options.name)
  const flags = options.flags ?? 0x0800
  const buffer = new ArrayBuffer(
    30 + nameBytes.length + options.payload.length + 46 + nameBytes.length + 22
  )
  const view = new DataView(buffer)
  const out = new Uint8Array(buffer)
  let offset = 0
  const u16 = (value: number) => {
    view.setUint16(offset, value, true)
    offset += 2
  }
  const u32 = (value: number) => {
    view.setUint32(offset, value, true)
    offset += 4
  }

  // Local file header
  u32(0x04034b50)
  u16(20)
  u16(flags)
  u16(options.method)
  u16(0)
  u16(0)
  u32(crc32(options.raw))
  u32(options.payload.length)
  u32(options.raw.length)
  u16(nameBytes.length)
  u16(0)
  out.set(nameBytes, offset)
  offset += nameBytes.length
  out.set(options.payload, offset)
  offset += options.payload.length

  // Central directory entry
  const centralOffset = offset
  u32(0x02014b50)
  u16(20)
  u16(20)
  u16(flags)
  u16(options.method)
  u16(0)
  u16(0)
  u32(crc32(options.raw))
  u32(options.payload.length)
  u32(options.raw.length)
  u16(nameBytes.length)
  u16(0)
  u16(0)
  u16(0)
  u16(0)
  u32(0)
  u32(0)
  out.set(nameBytes, offset)
  offset += nameBytes.length
  const centralSize = offset - centralOffset

  // End of central directory
  u32(0x06054b50)
  u16(0)
  u16(0)
  u16(1)
  u16(1)
  u32(centralSize)
  u32(centralOffset)
  u16(0)

  return buffer
}

describe('crc32', () => {
  it("CRC32 of 'hello' = 0x3610a686", () => {
    expect(crc32(bytes('hello'))).toBe(0x3610a686)
  })

  it('is stable for empty input', () => {
    expect(crc32(new Uint8Array(0))).toBe(0)
  })
})

describe('createZip / readZip', () => {
  it('zip roundtrip byte-identical', async () => {
    const files = [
      {
        name: 'personal.ics',
        data: bytes('BEGIN:VCALENDAR\r\nSUMMARY:Ständig\r\nEND:VCALENDAR\r\n')
      },
      { name: 'backup/contacts.vcf', data: new Uint8Array([0, 1, 2, 0xfe, 0xff]) }
    ]

    const blob = createZip(files)
    expect(blob.type).toBe('application/zip')

    const entries = await readZip(await blob.arrayBuffer())
    expect(entries.map((entry) => entry.name)).toEqual(['personal.ics', 'backup/contacts.vcf'])
    expect(Array.from(entries[0].data)).toEqual(Array.from(files[0].data))
    expect(Array.from(entries[1].data)).toEqual(Array.from(files[1].data))
    expect(decoder.decode(entries[0].data)).toContain('SUMMARY:Ständig')
  })

  it('readZip inflates deflate entry', async () => {
    const raw = bytes('BEGIN:VCARD\r\nFN:Maria Weber\r\nEND:VCARD\r\n'.repeat(20))
    const compressed = await deflateRaw(raw)
    expect(compressed.length).toBeLessThan(raw.length)

    const zip = buildEntryZip({ name: 'contacts.vcf', raw, payload: compressed, method: 8 })
    const entries = await readZip(zip)

    expect(entries).toHaveLength(1)
    expect(entries[0].name).toBe('contacts.vcf')
    expect(decoder.decode(entries[0].data)).toBe(decoder.decode(raw))
  })

  it('readZip rejects zip64', async () => {
    // ZIP64 announces itself with a locator record directly before the EOCD.
    const buffer = new ArrayBuffer(20 + 22)
    const view = new DataView(buffer)
    view.setUint32(0, 0x07064b50, true)
    view.setUint32(20, 0x06054b50, true)
    view.setUint16(30, 0xffff, true)

    await expect(readZip(buffer)).rejects.toThrow(/ZIP64/)
  })

  it('readZip rejects encrypted entries', async () => {
    const raw = bytes('secret')
    const zip = buildEntryZip({ name: 'secret.ics', raw, payload: raw, method: 0, flags: 0x0801 })

    await expect(readZip(zip)).rejects.toThrow(/Encrypted/)
  })

  it('readZip rejects data that is not a zip archive', async () => {
    await expect(readZip(new ArrayBuffer(40))).rejects.toThrow(/end of central directory/)
  })
})
