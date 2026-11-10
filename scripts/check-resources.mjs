#!/usr/bin/env node
import { existsSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cli = join(ROOT, 'resources', 'engine', 'audiocpp_cli')
const ffmpeg = join(ROOT, 'resources', 'ffmpeg', 'ffmpeg')

const missing = []
if (!existsSync(cli)) missing.push(cli)
if (!existsSync(ffmpeg)) missing.push(ffmpeg)

if (missing.length > 0) {
  console.error('Не хватает бинарников для сборки:')
  for (const path of missing) console.error(`  ${path}`)
  console.error('\nВыполните: npm run fetch:engine')
  process.exit(1)
}

console.log(`Движок: ${cli} (${(statSync(cli).size / 1024 / 1024).toFixed(1)} МБ)`)
console.log(`ffmpeg: ${ffmpeg} (${(statSync(ffmpeg).size / 1024 / 1024).toFixed(1)} МБ)`)
