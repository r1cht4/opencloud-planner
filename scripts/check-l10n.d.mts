/**
 * Type declarations for the dependency-free l10n checker that
 * `tests/unit/check-l10n.spec.ts` and `tests/unit/translations.spec.ts`
 * import (the implementation is plain Node ESM).
 */
export declare const LANGUAGES: string[]
export declare const DEFAULT_ROOT: string

/** One parsed PO/POT entry (header entries have an empty `msgid`). */
export interface PoEntry {
  msgctxt: string
  msgid: string
  msgid_plural: string | null
  msgstr: string[]
  fuzzy: boolean
  obsolete: boolean
}

export interface ParsedPoFile {
  headers: Record<string, string>
  entries: PoEntry[]
}

export interface L10nReport {
  ok: boolean
  exitCode: number
  potEntries: number
  missing: Record<string, string[]>
  empty: Record<string, string[]>
  placeholders: Record<string, string[]>
  /** msgids defined more than once per language (msgmerge refuses such a catalog). */
  duplicates: Record<string, string[]>
  jsonUpToDate: boolean
}

export declare function parsePoFile(source: string): ParsedPoFile
export declare function compilePoToMessages(entries: PoEntry[]): Record<string, string | string[]>
export declare function deepEqual(a: unknown, b: unknown): boolean
export declare function hasValidPlaceholders(entry: PoEntry): boolean
export declare function checkL10n(options?: { rootDir?: string }): L10nReport
export declare function formatReport(report: L10nReport): string
export declare function main(): number
