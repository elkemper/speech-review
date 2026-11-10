import { readFile } from 'node:fs/promises'
import { parseRawWords } from '@shared/transcript'
import type { Backend, RawWord } from '@shared/types'
import { runProcess, tail } from './proc'

export interface ChunkTranscriptionOptions {
  cli: string
  model: string
  backend: Backend
  audio: string
  language: string
  outputTxt: string
  outputJson: string
  offsetSec: number
  signal?: AbortSignal
  onLog?: (line: string) => void
}

export interface ChunkTranscription {
  words: RawWord[]
  text: string
}

const SAMPLE_RATE = 16000

export async function transcribeChunk(options: ChunkTranscriptionOptions): Promise<ChunkTranscription> {
  const args = [
    '--task',
    'asr',
    '--family',
    'crisperwhisper',
    '--model',
    options.model,
    '--backend',
    options.backend,
    '--audio',
    options.audio,
    '--request-option',
    `language=${options.language}`,
    '--request-option',
    'transcription_mode=verbatim',
    '--request-option',
    'return_timestamps=true',
    '--text-out',
    options.outputTxt,
    '--words-out',
    options.outputJson,
    '--log'
  ]

  const forward = (chunk: string): void => {
    for (const line of chunk.split('\n')) {
      const trimmed = line.trim()
      if (trimmed) options.onLog?.(trimmed)
    }
  }

  const result = await runProcess(options.cli, args, {
    signal: options.signal,
    // `--log` writes framework progress to stdout, so both streams matter
    // for diagnostics.
    onStdout: forward,
    onStderr: forward
  })

  if (result.code !== 0) {
    const details = tail(`${result.stdout}\n${result.stderr}`, 18)
    throw new Error(
      `CrisperWhisper завершился с кодом ${result.code}:\n${details || 'нет вывода'}`
    )
  }

  let jsonText: string
  try {
    jsonText = await readFile(options.outputJson, 'utf8')
  } catch {
    const details = tail(`${result.stdout}\n${result.stderr}`, 18)
    throw new Error(`CrisperWhisper не создал файл слов. Лог:\n${details || 'пусто'}`)
  }

  const raw = parseRawWords(jsonText)
  const offsetSamples = Math.round(options.offsetSec * SAMPLE_RATE)
  const words = raw.map((word) => ({
    ...word,
    start_sample: word.start_sample + offsetSamples,
    end_sample: word.end_sample + offsetSamples
  }))

  let text = ''
  try {
    text = (await readFile(options.outputTxt, 'utf8')).trim()
  } catch {
    text = words.map((word) => word.word).join(' ')
  }

  return { words, text }
}
