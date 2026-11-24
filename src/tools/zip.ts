/**
 * zip.ts – a minimal ZIP writer/reader written in-house (no dependency).
 *
 * The backup tool needs to hand the user *one* file instead of N `.ics`/`.vcf`
 * downloads. The ZIP format is simple enough to emit with a `DataView`, so the
 * lean principle (no new runtime dependencies) holds.
 *
 * Writer: always STORE (method 0) — the payloads are already compact iCalendar /
 * vCard text, a deflate implementation would only add code. Entry names are
 * UTF-8 and flagged as such (general purpose bit 11), so non-ASCII collection
 * names survive.
 *
 * Reader: accepts STORE *and* DEFLATE (method 8) so zips produced by other tools
 * (macOS "Compress", Windows Explorer) can be restored as well; inflating uses
 * the platform `DecompressionStream('deflate-raw')` (no dependency). Encrypted
 * entries and ZIP64 archives are rejected with a readable error instead of
 * producing garbage.
 */

/** One file inside a zip archive. */
export interface ZipEntry {
  /** Path inside the archive (forward slashes, UTF-8). */
  name: string
  /** Raw file bytes. */
  data: Uint8Array
}

/* ---------------------------------------------------------------------------
 * CRC32 (IEEE 802.3, as required by the ZIP spec)
 * ------------------------------------------------------------------------- */

let crcTable: Uint32Array | null = null

function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[i] = c >>> 0
  }
  crcTable = table
  return table
}

/** Standard CRC-32 check value of `data` (e.g. 0x3610a686 for 'hello'). */
export function crc32(data: Uint8Array): number {
  const table = getCrcTable()
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/* ---------------------------------------------------------------------------
 * Byte helpers
 * ------------------------------------------------------------------------- */

const SIG_LOCAL = 0x04034b50
const SIG_CENTRAL = 0x02014b50
const SIG_EOCD = 0x06054b50
const SIG_ZIP64_LOCATOR = 0x07064b50

const METHOD_STORE = 0
const METHOD_DEFLATE = 8
/** General purpose bit 11: entry name (and comment) are UTF-8. */
const FLAG_UTF8 = 0x0800
/** General purpose bit 0: entry is encrypted. */
const FLAG_ENCRYPTED = 0x0001

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8')

class ByteWriter {
  private parts: Uint8Array[] = []
  private length = 0

  get size(): number {
    return this.length
  }

  bytes(data: Uint8Array): void {
    this.parts.push(data)
    this.length += data.length
  }

  u16(value: number): void {
    this.withView(2, (view) => view.setUint16(0, value & 0xffff, true))
  }

  u32(value: number): void {
    this.withView(4, (view) => view.setUint32(0, value >>> 0, true))
  }

  toBlobParts(): Uint8Array[] {
    return this.parts
  }

  private withView(size: number, write: (view: DataView) => void): void {
    const buffer = new ArrayBuffer(size)
    write(new DataView(buffer))
    this.bytes(new Uint8Array(buffer))
  }
}

/** MS-DOS date/time pair (the only timestamp format ZIP knows). */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear())
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  }
}

/* ---------------------------------------------------------------------------
 * Writer
 * ------------------------------------------------------------------------- */

/**
 * Build a ZIP archive containing `files`, all stored uncompressed.
 *
 * Every entry is written with the UTF-8 name flag, its CRC32 and its real size,
 * followed by the central directory and the end-of-central-directory record —
 * the shape every unzip implementation (and `readZip` below) expects.
 */
export function createZip(files: ZipEntry[]): Blob {
  const out = new ByteWriter()
  const stamp = dosDateTime(new Date())
  const central: Array<{
    name: Uint8Array
    crc: number
    size: number
    offset: number
  }> = []

  for (const file of files) {
    const name = encoder.encode(file.name)
    const crc = crc32(file.data)
    const offset = out.size

    out.u32(SIG_LOCAL)
    out.u16(20) // version needed to extract (2.0)
    out.u16(FLAG_UTF8)
    out.u16(METHOD_STORE)
    out.u16(stamp.time)
    out.u16(stamp.date)
    out.u32(crc)
    out.u32(file.data.length) // compressed size == uncompressed (STORE)
    out.u32(file.data.length)
    out.u16(name.length)
    out.u16(0) // extra field length
    out.bytes(name)
    out.bytes(file.data)

    central.push({ name, crc, size: file.data.length, offset })
  }

  const centralOffset = out.size
  for (const entry of central) {
    out.u32(SIG_CENTRAL)
    out.u16(20) // version made by
    out.u16(20) // version needed to extract
    out.u16(FLAG_UTF8)
    out.u16(METHOD_STORE)
    out.u16(stamp.time)
    out.u16(stamp.date)
    out.u32(entry.crc)
    out.u32(entry.size)
    out.u32(entry.size)
    out.u16(entry.name.length)
    out.u16(0) // extra field length
    out.u16(0) // comment length
    out.u16(0) // disk number start
    out.u16(0) // internal attributes
    out.u32(0) // external attributes
    out.u32(entry.offset)
    out.bytes(entry.name)
  }
  const centralSize = out.size - centralOffset

  out.u32(SIG_EOCD)
  out.u16(0) // this disk
  out.u16(0) // disk with the central directory
  out.u16(central.length)
  out.u16(central.length)
  out.u32(centralSize)
  out.u32(centralOffset)
  out.u16(0) // comment length

  return new Blob(out.toBlobParts() as BlobPart[], { type: 'application/zip' })
}

/* ---------------------------------------------------------------------------
 * Reader
 * ------------------------------------------------------------------------- */

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('DEFLATE entries need DecompressionStream (not available here)')
  }
  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function findEndOfCentralDirectory(view: DataView, length: number): number {
  // The EOCD record is 22 bytes plus an optional comment of at most 0xffff.
  const lowest = Math.max(0, length - 22 - 0xffff)
  for (let i = length - 22; i >= lowest; i--) {
    if (view.getUint32(i, true) === SIG_EOCD) return i
  }
  return -1
}

/**
 * Read every file of a ZIP archive.
 *
 * Supports STORE and DEFLATE entries (the latter inflated through
 * `DecompressionStream`), strips nothing and keeps the entry order. ZIP64 and
 * encrypted archives throw — the backup tool can only produce/consume plain
 * STORE zips, and silently mis-reading them would corrupt a restore.
 */
export async function readZip(buf: ArrayBuffer): Promise<ZipEntry[]> {
  if (buf.byteLength < 22) throw new Error('Not a zip file: too short')

  const view = new DataView(buf)
  const bytes = new Uint8Array(buf)
  const eocd = findEndOfCentralDirectory(view, buf.byteLength)
  if (eocd === -1) throw new Error('Not a zip file: end of central directory not found')

  // ZIP64 announces itself with a locator record right before the EOCD.
  if (eocd >= 20 && view.getUint32(eocd - 20, true) === SIG_ZIP64_LOCATOR) {
    throw new Error('ZIP64 archives are not supported')
  }

  const entryCount = view.getUint16(eocd + 10, true)
  const centralOffset = view.getUint32(eocd + 16, true)
  if (entryCount === 0xffff || centralOffset === 0xffffffff) {
    throw new Error('ZIP64 archives are not supported')
  }
  if (centralOffset >= buf.byteLength) {
    throw new Error('Corrupt zip file: central directory outside the file')
  }

  const entries: ZipEntry[] = []
  let cursor = centralOffset

  for (let i = 0; i < entryCount; i++) {
    if (cursor + 46 > buf.byteLength || view.getUint32(cursor, true) !== SIG_CENTRAL) {
      throw new Error('Corrupt zip file: central directory entry not found')
    }

    const flags = view.getUint16(cursor + 8, true)
    const method = view.getUint16(cursor + 10, true)
    const compressedSize = view.getUint32(cursor + 20, true)
    const nameLength = view.getUint16(cursor + 28, true)
    const extraLength = view.getUint16(cursor + 30, true)
    const commentLength = view.getUint16(cursor + 32, true)
    const localOffset = view.getUint32(cursor + 42, true)
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength))

    if (flags & FLAG_ENCRYPTED) {
      throw new Error(`Encrypted zip entries are not supported (${name})`)
    }
    if (localOffset + 30 > buf.byteLength || view.getUint32(localOffset, true) !== SIG_LOCAL) {
      throw new Error(`Corrupt zip file: local header missing for ${name}`)
    }

    // The local header repeats name/extra lengths which may differ from the
    // central ones — the data starts after *these* fields.
    const localNameLength = view.getUint16(localOffset + 26, true)
    const localExtraLength = view.getUint16(localOffset + 28, true)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    if (dataStart + compressedSize > buf.byteLength) {
      throw new Error(`Corrupt zip file: data of ${name} is truncated`)
    }
    const raw = bytes.slice(dataStart, dataStart + compressedSize)

    let data: Uint8Array
    if (method === METHOD_STORE) {
      data = raw
    } else if (method === METHOD_DEFLATE) {
      data = await inflateRaw(raw)
    } else {
      throw new Error(`Unsupported zip compression method ${method} (${name})`)
    }

    if (!name.endsWith('/')) entries.push({ name, data })
    cursor += 46 + nameLength + extraLength + commentLength
  }

  return entries
}
