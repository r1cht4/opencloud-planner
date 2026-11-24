export interface StoreVersion {
  id: string
  version: string
  url: string
  releaseDate: string
  minOpenCloud?: string
}

export declare function addStoreVersion(
  text: string,
  version: StoreVersion
): { status: 'added' | 'exists' | 'not-listed'; text: string }

export declare function main(argv?: string[]): number
