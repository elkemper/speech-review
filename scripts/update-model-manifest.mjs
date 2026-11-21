#!/usr/bin/env node
/**
 * Regenerates model-manifest.json from live Hugging Face metadata.
 *
 * Zero dependencies: node:https + readline only. Model sizes and SHA-256
 * digests come from the HF tree API — GGUF files are stored via Git LFS and
 * the LFS oid is the sha256 of the file content, so nothing is downloaded.
 *
 * The manifest source of truth is the local file; the app fetches it from
 * the repository at runtime, so this script never reads the remote copy.
 *
 * Usage: npm run models:update
 */

import { get } from 'node:https'
import { readFile, writeFile, rename } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { diffEntry, nextVersion } from './model-manifest-lib.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST_PATH = join(ROOT, 'model-manifest.json')
const HF_TREE_URL =
  'https://huggingface.co/api/models/audio-cpp/audio.cpp-gguf/tree/main/CrisperWhisper2.0-GGUF'
const BASE_URL =
  'https://huggingface.co/audio-cpp/audio.cpp-gguf/resolve/main/CrisperWhisper2.0-GGUF'
const MODEL_IDS = new Set(['q8_0', 'bf16', 'q4_k'])

function fetchText(url, redirects = 0) {
  return new Promise((resolvePromise, reject) => {
    const request = get(
      url,
      { headers: { 'User-Agent': 'webinar-speech-review-manifest/0.1' } },
      (response) => {
        const status = response.statusCode ?? 0
        const location = response.headers.location
        if (status >= 300 && status < 400 && location && redirects < 8) {
          response.resume()
          resolvePromise(fetchText(new URL(location, url).toString(), redirects + 1))
          return
        }
        if (status !== 200) {
          response.resume()
          reject(new Error(`HTTP ${status} for ${url}`))
          return
        }
        const chunks = []
        response.on('data', (chunk) => chunks.push(chunk))
        response.on('error', reject)
        response.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')))
      }
    )
    request.on('error', reject)
    request.setTimeout(30_000, () => request.destroy(new Error(`Timeout ${url}`)))
  })
}

async function fetchJson(url) {
  return JSON.parse(await fetchText(url))
}

/** Known-good specs parsed from the app source, used as the fallback baseline. */
async function builtInSpecs() {
  const source = await readFile(join(ROOT, 'src/shared/models.ts'), 'utf8')
  const specs = {}
  const blockPattern =
    /(\w+): \{\s*\n\s*id: '(\w+)',[\s\S]*?file: '([^']+)',\s*\n\s*size: (\d+),\s*\n\s*sha256: '([0-9a-f]{64})'/g
  for (const match of source.matchAll(blockPattern)) {
    specs[match[2]] = { id: match[2], file: match[3], size: Number(match[4]), sha256: match[5] }
  }
  return specs
}

async function main() {
  // Piped stdin closes before the first question is asked, which would make
  // rl.question reject (or hang an interactive session). Read the whole pipe
  // up front and answer questions from that queue; TTY stays interactive.
  const isTTY = Boolean(stdin.isTTY)
  let pipedLines = []
  if (!isTTY) {
    const chunks = []
    for await (const chunk of stdin) chunks.push(chunk)
    pipedLines = Buffer.concat(chunks).toString('utf8').split('\n')
  }
  const rl = isTTY ? createInterface({ input: stdin, output: stdout }) : null

  let manifest = null
  try {
    manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'))
    console.log(`Local manifest read (${manifest.models.length} models)`)
  } catch {
    console.log('Local manifest not found, starting empty')
  }

  const specs = await builtInSpecs()
  console.log('Requesting Hugging Face metadata…')
  const tree = await fetchJson(HF_TREE_URL)
  const remote = new Map()
  for (const item of tree) {
    if (!item.path.endsWith('.gguf') || !item.lfs) continue
    const file = item.path.split('/').pop()
    remote.set(file, { size: item.size, sha256: item.lfs.oid })
  }
  console.log(`Hugging Face repository has ${remote.size} GGUF files`)
  console.log()

  const models = Array.isArray(manifest?.models) ? [...manifest.models] : []
  const changed = []
  const ask = async (prompt) => {
    if (!isTTY) {
      stdout.write(prompt)
      const answer = (pipedLines.shift() ?? '').trim()
      console.log(answer || '(empty)')
      return answer
    }
    try {
      return (await rl.question(prompt)).trim()
    } catch {
      // stdin closed unexpectedly — treat as "no".
      return ''
    }
  }

  // 1. Existing entries vs live HF metadata. Iterate over a snapshot so
  // removals cannot make the iterator skip the next entry.
  for (const entry of [...models]) {
    const live = remote.get(entry.file)
    if (!live) {
      const answer = await ask(
        `Model ${entry.id} (${entry.file}) is no longer on Hugging Face. Remove the entry? [y/N] `
      )
      if (answer.toLowerCase() === 'y') {
        const index = models.indexOf(entry)
        if (index >= 0) models.splice(index, 1)
        changed.push(entry.id)
        console.log(`  removed: ${entry.id}`)
      }
      continue
    }
    const diff = diffEntry(entry, live)
    if (!diff) continue
    console.log(
      `Model ${entry.id} changed on Hugging Face:\n` +
        `  size:   ${entry.size} -> ${live.size}${diff.sizeChanged ? '' : ' (unchanged)'}\n` +
        `  sha256: ${entry.sha256.slice(0, 12)}… -> ${live.sha256.slice(0, 12)}…${
          diff.hashChanged ? '' : ' (unchanged)'
        }`
    )
    const answer = await ask('  Add as a new version? [y/N] ')
    if (answer.toLowerCase() === 'y') {
      const suggestion = nextVersion(new Date(), models.map((item) => item.version))
      const version = (await ask(`  Version [${suggestion}]: `)) || suggestion
      entry.size = live.size
      entry.sha256 = live.sha256
      entry.version = version
      entry.releasedAt = new Date().toISOString().slice(0, 10)
      entry.url = `${BASE_URL}/${entry.file}`
      changed.push(entry.id)
      console.log(`  updated: ${entry.id} -> ${version}`)
    } else {
      console.log('  entry left unchanged')
    }
  }

  // 2. Known ids present in built-in specs but missing from the manifest.
  for (const [id, spec] of Object.entries(specs)) {
    if (models.some((entry) => entry.id === id)) continue
    const answer = await ask(`Model ${id} exists in code but not in the manifest. Add it? [y/N] `)
    if (answer.toLowerCase() !== 'y') continue
    const live = remote.get(spec.file)
    const suggestion = nextVersion(new Date(), models.map((item) => item.version))
    const version = (await ask(`  Version [${suggestion}]: `)) || suggestion
    models.push({
      id,
      version,
      releasedAt: new Date().toISOString().slice(0, 10),
      file: spec.file,
      size: live ? live.size : spec.size,
      sha256: live ? live.sha256 : spec.sha256,
      url: `${BASE_URL}/${spec.file}`
    })
    changed.push(id)
    console.log(`  added: ${id} -> ${version}`)
  }

  // 3. GGUF files on HF that match no known id.
  for (const [file, live] of remote) {
    if (models.some((entry) => entry.file === file)) continue
    console.log(`New file on Hugging Face: ${file} (${live.size} bytes, ${live.sha256.slice(0, 12)}…)`)
    const id = (
      await ask('  Add to the manifest? Enter a model id (q8_0/bf16/q4_k), empty to skip: ')
    ).toLowerCase()
    if (!MODEL_IDS.has(id)) continue
    const suggestion = nextVersion(new Date(), models.map((item) => item.version))
    const version = (await ask(`  Version [${suggestion}]: `)) || suggestion
    models.push({
      id,
      version,
      releasedAt: new Date().toISOString().slice(0, 10),
      file,
      size: live.size,
      sha256: live.sha256,
      url: `${BASE_URL}/${file}`
    })
    changed.push(id)
    console.log(`  added: ${id} -> ${version}`)
  }

  if (changed.length === 0 && models.length === (manifest?.models.length ?? 0)) {
    const answer = await ask('No changes. Rewrite generatedAt and save anyway? [y/N] ')
    if (answer.toLowerCase() !== 'y') {
      console.log('Exiting without writing.')
      rl?.close()
      return
    }
  }

  const order = ['q8_0', 'bf16', 'q4_k']
  models.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
  const output = {
    formatVersion: 1,
    generatedAt: new Date().toISOString(),
    models: models.map((entry) => ({
      id: entry.id,
      version: entry.version,
      releasedAt: entry.releasedAt,
      file: entry.file,
      size: entry.size,
      sha256: entry.sha256,
      url: entry.url
    }))
  }

  const temporary = `${MANIFEST_PATH}.tmp`
  await writeFile(temporary, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
  await rename(temporary, MANIFEST_PATH)
  console.log(`\nManifest written: ${MANIFEST_PATH} (${output.models.length} models)`)
  console.log('Commit the file — the app picks it up after it lands on the default branch.')
  rl?.close()
}

main().catch((error) => {
  console.error(`Error: ${error.message}`)
  process.exitCode = 1
})
