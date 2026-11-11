#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const modules = join(root, 'node_modules')
const platform = process.platform
const arch = process.arch

function fail(message) {
  console.error(`\n[check-platform] ${message}\n`)
  process.exit(1)
}

if (!existsSync(modules)) fail('node_modules не найден. Выполните npm install.')

const electronPath = join(modules, 'electron', 'path.txt')
if (!existsSync(electronPath)) {
  fail('Пакет electron установлен не полностью. Выполните npm install на этой машине.')
}
const relative = readFileSync(electronPath, 'utf8').trim()
if (!existsSync(join(modules, 'electron', 'dist', relative))) {
  fail(
    `Бинарник Electron отсутствует (${relative}). ` +
      'Похоже, node_modules собран для другой ОС. Выполните npm install здесь.'
  )
}

const suffix =
  platform === 'win32'
    ? `${arch}-msvc`
    : platform === 'linux'
      ? `${arch}-gnu`
      : arch

const required = [
  join(modules, '@rolldown', `binding-${platform}-${suffix}`),
  join(modules, `lightningcss-${platform}-${suffix}`)
]

const missing = required.filter((path) => !existsSync(path))
if (missing.length > 0) {
  fail(
    'Нативные модули не подходят текущей платформе:\n' +
      missing.map((path) => `  - ${path}`).join('\n') +
      '\nВыполните npm install на этой машине.'
  )
}

if (existsSync(join(root, 'node_modules_linux')) && platform !== 'linux') {
  console.log(
    '[check-platform] найден node_modules_linux — это старый Linux-набор, приложение его не использует.'
  )
}
