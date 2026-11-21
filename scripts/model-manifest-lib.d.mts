export interface ManifestEntryLike {
  size: number
  sha256: string
}

export interface EntryDiff {
  sizeChanged: boolean
  hashChanged: boolean
}

export function nextVersion(today: Date, existingVersions: Array<string | undefined>): string

export function diffEntry(
  entry: ManifestEntryLike,
  remote: ManifestEntryLike
): EntryDiff | null
