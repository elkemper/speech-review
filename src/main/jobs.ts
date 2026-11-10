import { randomUUID } from 'node:crypto'
import { access, mkdir, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import { buildTranscript } from '@shared/transcript'
import type {
  Peaks,
  RawWord,
  StartTranscriptionResult,
  TranscribeDone,
  TranscribeError,
  TranscribeProgress,
  TranscribeRequest
} from '@shared/types'
import { engineBinary, ffmpegBinary, tempDir } from './paths'
import { detectSilences, extractAudio, probeMedia } from './engine/ffmpeg'
import { computePeaks, readWavInfo, sliceWav } from './engine/wav'
import { planChunks } from './engine/chunks'
import { ensureModel } from './engine/models'
import { transcribeChunk } from './engine/crisperwhisper'
import { loadProject, savePeaks, saveProject, writeTranscript } from './projects'

export interface TranscriptionEvents {
  progress: (progress: TranscribeProgress) => void
  done: (done: TranscribeDone) => void
  error: (error: TranscribeError) => void
}

interface Job {
  id: string
  projectId: string
  controller: AbortController
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

export class TranscriptionManager {
  private jobs = new Map<string, Job>()

  constructor(private readonly events: TranscriptionEvents) {}

  start(request: TranscribeRequest): StartTranscriptionResult {
    for (const existing of this.jobs.values()) {
      if (existing.projectId === request.projectId) {
        throw new Error('Для этого проекта уже идёт распознавание')
      }
    }

    const id = randomUUID()
    const controller = new AbortController()
    const job: Job = { id, projectId: request.projectId, controller }
    this.jobs.set(id, job)

    void this.run(job, request)
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        this.events.error({ jobId: id, projectId: job.projectId, message: errorMessage(error) })
      })
      .finally(() => {
        this.jobs.delete(id)
      })

    return { jobId: id }
  }

  cancel(jobId: string): void {
    this.jobs.get(jobId)?.controller.abort()
  }

  cancelProject(projectId: string): void {
    for (const job of this.jobs.values()) {
      if (job.projectId === projectId) job.controller.abort()
    }
  }

  cancelAll(): void {
    for (const job of this.jobs.values()) job.controller.abort()
    this.jobs.clear()
  }

  private progress(
    jobId: string,
    phase: TranscribeProgress['phase'],
    percent: number,
    message: string,
    chunk?: number,
    chunks?: number
  ): void {
    this.events.progress({
      jobId,
      projectId: this.jobs.get(jobId)?.projectId ?? '',
      phase,
      percent: Math.max(0, Math.min(100, Math.round(percent))),
      message,
      chunk,
      chunks
    })
  }

  private async run(job: Job, request: TranscribeRequest): Promise<void> {
    const { signal } = job.controller
    const jobDir = join(tempDir(), 'jobs', job.id)

    try {
      this.progress(job.id, 'prepare', 1, 'Готовлю задачу…')

      const loaded = await loadProject(request.projectId)
      const project = loaded.project
      const videoPath = project.video.path
      if (!videoPath) throw new Error('В проекте не указан видеофайл')

      await access(videoPath, constants.R_OK)
      await mkdir(jobDir, { recursive: true })

      const ffmpeg = ffmpegBinary()
      if (!ffmpeg) throw new Error('ffmpeg не найден. Запустите npm run fetch:engine.')
      await access(ffmpeg, constants.X_OK)

      const cli = engineBinary()
      await access(cli, constants.X_OK).catch(() => {
        throw new Error(
          'Движок audio.cpp не найден в resources/engine. Запустите npm run fetch:engine.'
        )
      })

      this.progress(job.id, 'prepare', 3, 'Проверяю модель…')
      const model = await ensureModel(request.modelId)

      project.language = request.language
      project.modelId = request.modelId
      project.backend = request.backend
      project.rules = request.rules
      await saveProject(project)

      const audioPath = join(jobDir, 'audio.wav')
      const probe = await probeMedia(ffmpeg, videoPath, signal)
      if (!probe.hasAudio) throw new Error('В выбранном файле нет аудиодорожки')

      this.progress(job.id, 'audio', 4, 'Извлекаю аудио 16 кГц…')
      await extractAudio({
        ffmpeg,
        input: videoPath,
        output: audioPath,
        duration: probe.duration,
        signal,
        onProgress: (fraction) => {
          this.progress(job.id, 'audio', 4 + fraction * 26, `Извлекаю аудио… ${Math.round(fraction * 100)}%`)
        }
      })

      const info = await readWavInfo(audioPath)
      if (info.duration <= 0.1) throw new Error('Аудиодорожка пустая')

      this.progress(job.id, 'silence', 31, 'Ищу паузы для нарезки…')
      const silences = await detectSilences(ffmpeg, audioPath, info.duration, {
        signal,
        noiseDb: -38,
        minSilenceSec: 0.45
      })

      this.progress(job.id, 'peaks', 33, 'Строю осциллограмму…')
      let peaks: Peaks | null = null
      try {
        peaks = await computePeaks(info, {
          peaksPerSecond: 20,
          signal,
          onProgress: (fraction) => {
            this.progress(job.id, 'peaks', 33 + fraction * 11, 'Строю осциллограмму…')
          }
        })
        await savePeaks(project.id, peaks)
      } catch (error) {
        if (signal.aborted) throw error
        peaks = null
      }

      const chunks = planChunks(info.duration, silences, {
        targetSec: 600,
        minSec: 300,
        maxSec: 900
      })
      if (chunks.length === 0) throw new Error('Не удалось разбить запись на фрагменты')

      const allWords: RawWord[] = []
      for (let i = 0; i < chunks.length; i++) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
        const chunk = chunks[i]
        const chunkAudio = join(jobDir, `chunk-${String(i).padStart(3, '0')}.wav`)
        const chunkTxt = join(jobDir, `chunk-${String(i).padStart(3, '0')}.txt`)
        const chunkJson = join(jobDir, `chunk-${String(i).padStart(3, '0')}.json`)

        this.progress(
          job.id,
          'transcribe',
          45 + (i / chunks.length) * 52,
          `Распознаю фрагмент ${i + 1} из ${chunks.length}…`,
          i + 1,
          chunks.length
        )

        await sliceWav(info, chunk.start, chunk.end, chunkAudio, signal)
        const result = await transcribeChunk({
          cli,
          model,
          backend: request.backend,
          audio: chunkAudio,
          language: request.language,
          outputTxt: chunkTxt,
          outputJson: chunkJson,
          offsetSec: chunk.start,
          signal,
          onLog: (line) => {
            if (process.env.NODE_ENV !== 'production') console.log(`[asr ${i + 1}] ${line}`)
          }
        })

        allWords.push(...result.words)
        this.progress(
          job.id,
          'transcribe',
          45 + ((i + 1) / chunks.length) * 52,
          `Распознан фрагмент ${i + 1} из ${chunks.length}`,
          i + 1,
          chunks.length
        )
      }

      this.progress(job.id, 'merge', 98, 'Собираю транскрипт…')
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
      allWords.sort((a, b) => a.start_sample - b.start_sample)

      const transcript = buildTranscript(allWords, {
        language: request.language,
        sampleRate: 16000,
        duration: info.duration
      })

      await writeTranscript(project.id, transcript, true)
      const updated = await loadProject(project.id)
      this.progress(job.id, 'done', 100, 'Готово')

      this.events.done({
        jobId: job.id,
        projectId: project.id,
        project: updated.project,
        peaks: updated.peaks
      })
    } finally {
      await rm(jobDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}
