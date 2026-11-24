/**
 * importFileLimits.ts – one size cap for every file the app parses on the main
 * thread: Files-app .ics/.vcf imports, CSV imports. A huge file
 * would freeze the tab while ical.js/the CSV parser chew through it, so files
 * above the cap are refused with a message instead of parsed.
 */

/** Maximum importable file size: ~20 MB. */
const MAX_IMPORT_FILE_BYTES = 20 * 1024 * 1024

/** The cap in whole MB, for the message. */
const MAX_IMPORT_FILE_MB = 20

/** True when a File/resource's byte size is above the import cap. */
export function isOversizedImportFile(file: { size?: number | null }): boolean {
  return typeof file.size === 'number' && file.size > MAX_IMPORT_FILE_BYTES
}

/** True when already-read text is above the import cap (chars ≈ bytes for the cap's purpose). */
export function isOversizedImportText(text: string): boolean {
  return text.length > MAX_IMPORT_FILE_BYTES
}

/** The translated "file too large" message (interpolated with the cap in MB). */
export function oversizedImportMessage(
  $gettext: (text: string, params?: Record<string, string | number>) => string
): string {
  return $gettext('This file is too large to import. The maximum size is %{megabytes} MB.', {
    megabytes: MAX_IMPORT_FILE_MB
  })
}
