/**
 * csv.ts – RFC 4180 CSV parsing/serialising for the contacts CSV tool.
 *
 * Deliberately small and dependency-free. It sniffs the delimiter (`,` `;` `\t`)
 * because the same export exists in differently localised flavours — German
 * Outlook writes `;` — and it strips a UTF-8 BOM, which Excel prepends and which
 * would otherwise turn the first header cell into `\uFEFFVorname` and break the
 * header mapping.
 *
 * Quoted fields may contain the delimiter, doubled quotes and real newlines;
 * they survive parsing unchanged (line endings inside a field are normalised to
 * `\n`).
 */

export type CsvDelimiter = ',' | ';' | '\t'

/** Delimiters we sniff for, in tie-break order. */
const CSV_DELIMITERS: CsvDelimiter[] = [',', ';', '\t']

/** Remove a leading UTF-8 BOM (Excel, Outlook and Google all emit one sometimes). */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/**
 * Guess the delimiter from the first few lines: the character that appears most
 * often *outside* quotes wins. Ties resolve by `CSV_DELIMITERS` order; a file
 * without any delimiter is treated as comma-separated.
 */
export function detectDelimiter(text: string): CsvDelimiter {
  const sample = stripBom(text).split('\n').slice(0, 5).join('\n')
  const counts: Record<CsvDelimiter, number> = { ',': 0, ';': 0, '\t': 0 }
  let inQuotes = false

  for (const char of sample) {
    if (char === '"') {
      inQuotes = !inQuotes
      continue
    }
    if (inQuotes) continue
    if (char === ',' || char === ';' || char === '\t') counts[char]++
  }

  let best: CsvDelimiter = ','
  for (const delimiter of CSV_DELIMITERS) {
    if (counts[delimiter] > counts[best]) best = delimiter
  }
  return best
}

/**
 * Parse CSV text into rows of cells.
 *
 * - BOM stripped, CRLF/CR normalised to LF, delimiter sniffed.
 * - Quoted fields support `""` escapes, embedded delimiters and embedded newlines.
 * - Completely empty rows (trailing newline, blank lines) are dropped; a row of
 *   empty cells is kept, since it can carry positional meaning in a mapping.
 */
export function parseCsv(text: string): string[][] {
  const source = stripBom(text).replace(/\r\n?/g, '\n')
  const delimiter = detectDelimiter(source)

  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let hasContent = false

  for (let i = 0; i < source.length; i++) {
    const char = source[i]

    if (inQuotes) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }

    if (char === '"' && field === '') {
      inQuotes = true
      hasContent = true
      continue
    }
    if (char === delimiter) {
      row.push(field)
      field = ''
      hasContent = true
      continue
    }
    if (char === '\n') {
      row.push(field)
      if (hasContent || row.some((cell) => cell !== '')) rows.push(row)
      row = []
      field = ''
      hasContent = false
      continue
    }

    field += char
    if (char.trim()) hasContent = true
  }

  row.push(field)
  if (hasContent || row.some((cell) => cell !== '')) rows.push(row)

  return rows
}

/**
 * Spreadsheet formula-injection guard: contact data from received
 * vCards can start with `=`, `@`, TAB or CR — Excel/LibreOffice would execute
 * such a cell as a formula when the CSV is opened. Those cells get a leading
 * `'` (the spreadsheet convention for "literal text"). `+`/`-` are only
 * prefixed when NOT followed by a digit or a space, which keeps phone numbers
 * (`+49…`, `-5`) and simple arithmetic-looking text intact.
 */
export function guardCsvFormula(cell: string): string {
  if (!cell) return cell
  const first = cell.charAt(0)
  if (first === '=' || first === '@' || first === '\t' || first === '\r') return `'${cell}`
  if (first === '+' || first === '-') {
    const second = cell.charAt(1)
    if (second === '' || (second !== ' ' && !/\d/.test(second))) return `'${cell}`
  }
  return cell
}

/**
 * Serialise rows to CSV (comma separated, CRLF line endings, trailing newline) —
 * the shape Google Contacts and Outlook accept for import. Cells containing the
 * delimiter, a quote or a line break are quoted and their quotes doubled.
 * Cells that could start a spreadsheet formula are prefixed with `'` first
 * (the guard also applies inside quoted cells).
 */
export function toCsv(rows: string[][]): string {
  const escapeCell = (cell: string): string => {
    const safe = guardCsvFormula(cell ?? '')
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
  }

  return (
    rows.map((row) => row.map((cell) => escapeCell(cell ?? '')).join(',')).join('\r\n') + '\r\n'
  )
}
