/**
 * Pure helpers for update-model-manifest.mjs, kept side-effect free so tests
 * can import them without network access.
 */

/**
 * Suggests the next calendar version (YYYY.M.patch) for the given date,
 * incrementing the patch when a version from the same month exists.
 */
export function nextVersion(today, existingVersions) {
  const year = today.getUTCFullYear()
  const month = today.getUTCMonth() + 1
  const prefix = `${year}.${month}.`
  let maxPatch = 0
  for (const version of existingVersions) {
    if (typeof version === 'string' && version.startsWith(prefix)) {
      const patch = Number(version.slice(prefix.length))
      if (Number.isInteger(patch) && patch > maxPatch) maxPatch = patch
    }
  }
  return `${prefix}${maxPatch + 1}`
}

/**
 * Compares a manifest entry with live HF metadata. Returns null when they
 * match, otherwise which of size/hash drifted.
 */
export function diffEntry(entry, remote) {
  const sizeChanged = entry.size !== remote.size
  const hashChanged = entry.sha256 !== remote.sha256
  if (!sizeChanged && !hashChanged) return null
  return { sizeChanged, hashChanged }
}
