#!/usr/bin/env node
import { chmodSync, createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { get } from 'node:https'
import { dirname, join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { spawnSync } from 'node:child_process'
import { createGunzip } from 'node:zlib'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FORCE = process.argv.includes('--force')
const RELEASE = 'v0.9.4'
const FFMPEG_RELEASE = 'b6.1.1'
const platform = process.platform
const arch = process.arch
const key = `${platform}-${arch}`

const ENGINE_ASSETS = {
  'darwin-arm64': 'audio-v0.9.4-bin-macos-arm64-metal.tar.gz',
  'darwin-x64': 'audio-v0.9.4-bin-macos-x64-metal.tar.gz',
  'linux-x64': 'audio-v0.9.4-bin-ubuntu-x64-cpu.tar.gz',
  'win32-x64': 'audio-v0.9.4-bin-windows-x64-cpu.zip'
}

function download(url, destination, label) {
  return new Promise((resolvePromise, reject) => {
    const request = (target, redirects) => {
      const req = get(
        target,
        { headers: { 'User-Agent': 'webinar-speech-review/0.1' } },
        (response) => {
          const status = response.statusCode ?? 0
          const location = response.headers.location
          if (status >= 300 && status < 400 && location && redirects < 8) {
            response.resume()
            request(new URL(location, target).toString(), redirects + 1)
            return
          }
          if (status !== 200) {
            response.resume()
            reject(new Error(`${label}: HTTP ${status}`))
            return
          }

          const total = Number(response.headers['content-length'] ?? 0)
          let received = 0
          let lastPercent = -1
          response.on('data', (chunk) => {
            received += chunk.length
            if (!total) return
            const percent = Math.floor((received / total) * 100)
            if (percent !== lastPercent && percent % 2 === 0) {
              lastPercent = percent
              process.stdout.write(`\r  ${label}: ${percent}%`)
            }
          })

          pipeline(response, createWriteStream(destination))
            .then(() => {
              process.stdout.write(`\r  ${label}: 100%\n`)
              resolvePromise()
            })
            .catch(reject)
        }
      )
      req.on('error', reject)
      req.setTimeout(60_000, () => req.destroy(new Error(`${label}: таймаут`)))
    }
    request(url, 0)
  })
}

function extract(archive, destination) {
  const result = spawnSync('tar', ['-xf', archive, '-C', destination], { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error('Не удалось распаковать архив (нужен tar)')
}

async function installEngine() {
  const engineDir = join(ROOT, 'resources', 'engine')
  const cliName = platform === 'win32' ? 'audiocpp_cli.exe' : 'audiocpp_cli'
  const cliPath = join(engineDir, cliName)
  const asset = ENGINE_ASSETS[key]

  if (!asset) {
    throw new Error(
      `Для платформы ${key} нет готовой сборки audio.cpp в этом скрипте. Поддерживаются: ${Object.keys(
        ENGINE_ASSETS
      ).join(', ')}`
    )
  }

  if (existsSync(cliPath) && !FORCE) {
    console.log(`audio.cpp уже установлен: ${cliPath}`)
    return
  }

  const archive = join(ROOT, 'resources', `.engine-${asset}`)
  const tempDir = join(ROOT, 'resources', '.engine-tmp')
  mkdirSync(join(ROOT, 'resources'), { recursive: true })
  rmSync(tempDir, { recursive: true, force: true })
  mkdirSync(tempDir, { recursive: true })

  console.log(`Скачиваю audio.cpp ${RELEASE} (${key})…`)
  await download(
    `https://github.com/0xShug0/audio.cpp/releases/download/${RELEASE}/${asset}`,
    archive,
    'audio.cpp'
  )
  console.log('  распаковываю…')
  extract(archive, tempDir)

  rmSync(engineDir, { recursive: true, force: true })
  renameSync(tempDir, engineDir)
  rmSync(archive, { force: true })

  if (!existsSync(cliPath)) {
    throw new Error(`В архиве не найден ${cliName}`)
  }
  chmodSync(cliPath, 0o755)
  console.log(`  готово: ${cliPath}`)
}

async function installFfmpeg() {
  const ffmpegDir = join(ROOT, 'resources', 'ffmpeg')
  const ffmpegName = platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  const ffmpegPath = join(ffmpegDir, ffmpegName)
  const supported = ['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64', 'win32-x64']

  if (!supported.includes(key)) {
    throw new Error(`Для платформы ${key} нет готового ffmpeg в этом скрипте`)
  }
  if (existsSync(ffmpegPath) && !FORCE) {
    console.log(`ffmpeg уже установлен: ${ffmpegPath}`)
    return
  }

  mkdirSync(ffmpegDir, { recursive: true })
  const compressed = join(ffmpegDir, 'ffmpeg.gz')
  const temporary = join(ffmpegDir, 'ffmpeg.tmp')

  console.log(`Скачиваю ffmpeg ${FFMPEG_RELEASE} (${key})…`)
  await download(
    `https://github.com/eugeneware/ffmpeg-static/releases/download/${FFMPEG_RELEASE}/ffmpeg-${key}.gz`,
    compressed,
    'ffmpeg'
  )
  await pipeline(createReadStream(compressed), createGunzip(), createWriteStream(temporary))
  renameSync(temporary, ffmpegPath)
  rmSync(compressed, { force: true })
  chmodSync(ffmpegPath, 0o755)

  const license = join(ffmpegDir, 'LICENSE')
  await download(
    `https://github.com/eugeneware/ffmpeg-static/releases/download/${FFMPEG_RELEASE}/${key}.LICENSE`,
    license,
    'ffmpeg license'
  ).catch(() => undefined)

  console.log(`  готово: ${ffmpegPath}`)
}

async function main() {
  console.log('Подготовка локального движка Speech Review')
  console.log(`Платформа: ${key}\n`)
  await installEngine()
  await installFfmpeg()

  const modelDir = join(ROOT, 'resources', 'engine')
  console.log('\nГотово.')
  console.log(`  движок:  ${join(modelDir, platform === 'win32' ? 'audiocpp_cli.exe' : 'audiocpp_cli')}`)
  console.log(`  ffmpeg:  ${join(ROOT, 'resources', 'ffmpeg', platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')}`)
  console.log('  модель:  скачивается из приложения при первом запуске (1.6 ГБ)')
  console.log('\nЛицензии: audio.cpp — Apache-2.0, ffmpeg — GPL-3.0,')
  console.log('модель CrisperWhisper 2.0 — Nyra Health Non-Commercial Research License.')
}

main().catch((error) => {
  console.error(`\nОшибка: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
