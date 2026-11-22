import { randomUUID } from 'node:crypto'
import { access, mkdir, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import { translate } from '@shared/i18n'
import { buildTranscript } from '@shared/transcript'
import type {
  Peaks,
  RawWord,
  StartTranscriptionResult,
  TranscribeDone,
  TranscribeError,
  TranscribePartial,
  TranscribeProgress,
  TranscribeRequest
} from '@shared/types'
import { normalizeChunkTarget } from '@shared/settings'
import { engineBinary, ffmpegBinary, tempDir } from './paths'
import { detectSilences, extractAudio, probeMedia } from './engine/ffmpeg'
import { computePeaks, readWavInfo, sliceWav } from './engine/wav'
import { planChunks } from './engine/chunks'
import { ensureModel } from './engine/models'
import { transcribeChunk } from './engine/crisperwhisper'
import { loadProject, savePeaks, saveProject, writeTranscript } from './projects'
import { currentUiLanguage } from './uiLanguage'

export interface TranscriptionEvents {
  progress: (progress: TranscribeProgress) => void
  partial: (partial: TranscribePartial) => void
  done: (done: TranscribeDone) => void
  error: (error: TranscribeError) => void
}

interface Job {
  id: string
  projectId: string
  controller: AbortController
}

function t(key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]): string {
  return translate(currentUiLanguage(), key, params)
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
        throw new Error(t('error.recognitionRunning'))
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
    chunks?: number,
    extra: Pick<
      TranscribeProgress,
      'indeterminate' | 'processedSec' | 'totalSec' | 'etaSec'
    > = {}
  ): void {
    this.events.progress({
      jobId,
      projectId: this.jobs.get(jobId)?.projectId ?? '',
      phase,
      percent: Math.max(0, Math.min(100, Math.round(percent))),
      message,
      chunk,
      chunks,
      ...extra
    })
  }

  private async run(job: Job, request: TranscribeRequest): Promise<void> {
    const { signal } = job.controller
    const jobDir = join(tempDir(), 'jobs', job.id)

    try {
      this.progress(job.id, 'prepare', 1, t('progress.prepareJob'))

      const loaded = await loadProject(request.projectId)
      const project = loaded.project
      const videoPath = project.video.path
      if (!videoPath) throw new Error(t('error.noVideoPath'))

      await access(videoPath, constants.R_OK)
      await mkdir(jobDir, { recursive: true })

      const ffmpeg = ffmpegBinary()
      if (!ffmpeg) throw new Error(t('error.ffmpegMissing'))
      await access(ffmpeg, constants.X_OK)

      const cli = engineBinary()
      await access(cli, constants.X_OK).catch(() => {
        throw new Error(
          t('error.engineMissing')
        )
      })

      this.progress(job.id, 'prepare', 3, t('progress.checkModel'))
      const model = await ensureModel(request.modelId)

      project.language = request.language
      project.modelId = request.modelId
      project.backend = request.backend
      project.rules = request.rules
      await saveProject(project)

      const audioPath = join(jobDir, 'audio.wav')
      const probe = await probeMedia(ffmpeg, videoPath, signal)
      if (!probe.hasAudio) throw new Error(t('error.noAudioTrack'))

      this.progress(job.id, 'audio', 4, t('progress.extractAudio'))
      await extractAudio({
        ffmpeg,
        input: videoPath,
        output: audioPath,
        duration: probe.duration,
        signal,
        onProgress: (fraction) => {
          this.progress(job.id, 'audio', 4 + fraction * 26, t('progress.extractAudioPercent', { percent: Math.round(fraction * 100) }))
        }
      })

      const info = await readWavInfo(audioPath)
      if (info.duration <= 0.1) throw new Error(t('error.emptyAudio'))

      this.progress(job.id, 'silence', 31, t('progress.detectSilence'), undefined, undefined, {
        indeterminate: true
      })
      const silences = await detectSilences(ffmpeg, audioPath, info.duration, {
        signal,
        noiseDb: -38,
        minSilenceSec: 0.45
      })

      this.progress(job.id, 'peaks', 33, t('progress.buildPeaks'), undefined, undefined, {
        indeterminate: true
      })
      let peaks: Peaks | null = null
      try {
        peaks = await computePeaks(info, {
          peaksPerSecond: 20,
          signal,
          onProgress: (fraction) => {
            this.progress(job.id, 'peaks', 33 + fraction * 11, t('progress.buildPeaks'), undefined, undefined, {
              indeterminate: true
            })
          }
        })
        await savePeaks(project.id, peaks)
      } catch (error) {
        if (signal.aborted) throw error
        peaks = null
      }

      const targetSec = normalizeChunkTarget(request.chunkTargetSec)
      const minSec = Math.max(60, Math.round(targetSec * 0.5))
      const maxSec = Math.min(1200, Math.round(targetSec * 1.5))
      const firstChunkSec = Math.min(180, Math.max(90, Math.round(targetSec * 0.3)))
      const chunks = planChunks(info.duration, silences, {
        targetSec,
        minSec,
        maxSec,
        firstChunkSec
      })
      if (chunks.length === 0) throw new Error(t('error.chunkPlanFailed'))

      const totalSec = chunks.reduce((sum, chunk) => sum + chunk.duration, 0)
      let processedSec = 0
      const transcribeStarted = Date.now()
      let firstPartial = true
      const allWords: RawWord[] = []

      const transcribePercent = (): number =>
        totalSec > 0 ? (processedSec / totalSec) * 100 : 0
      const etaSec = (): number | undefined => {
        if (processedSec <= 0 || totalSec <= 0) return undefined
        const elapsed = (Date.now() - transcribeStarted) / 1000
        return Math.max(0, Math.round((elapsed * (totalSec - processedSec)) / processedSec))
      }

      for (let i = 0; i < chunks.length; i++) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
        const chunk = chunks[i]
        const chunkAudio = join(jobDir, `chunk-${String(i).padStart(3, '0')}.wav`)
        const chunkTxt = join(jobDir, `chunk-${String(i).padStart(3, '0')}.txt`)
        const chunkJson = join(jobDir, `chunk-${String(i).padStart(3, '0')}.json`)

        this.progress(
          job.id,
          'transcribe',
          transcribePercent(),
          t('progress.transcribeChunk', { index: i + 1, count: chunks.length }),
          i + 1,
          chunks.length,
          {
            indeterminate: false,
            processedSec: Math.round(processedSec),
            totalSec: Math.round(totalSec),
            etaSec: etaSec()
          }
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
        processedSec += chunk.duration

        this.progress(
          job.id,
          'transcribe',
          transcribePercent(),
          t('progress.chunkDone', { index: i + 1, count: chunks.length }),
          i + 1,
          chunks.length,
          {
            indeterminate: false,
            processedSec: Math.round(processedSec),
            totalSec: Math.round(totalSec),
            etaSec: etaSec()
          }
        )

        // Publish the prefix that is already recognized. Word ids stay stable
        // while later chunks are appended, so review marks do not jump.
        try {
          const partialTranscript = buildTranscript(allWords, {
            language: request.language,
            sampleRate: 16000,
            duration: info.duration
          })
          await writeTranscript(project.id, partialTranscript, false, firstPartial)
          firstPartial = false
          const partial = await loadProject(project.id)
          this.events.partial({
            jobId: job.id,
            projectId: project.id,
            project: partial.project,
            peaks: partial.peaks,
            chunk: i + 1,
            chunks: chunks.length
          })
        } catch (error) {
          if (signal.aborted) throw error
          console.warn(t('error.intermediateTranscript'), error)
        }
      }

      this.progress(job.id, 'merge', 98, t('progress.merge'), undefined, undefined, {
        indeterminate: true
      })
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
      allWords.sort((a, b) => a.start_sample - b.start_sample)

      const transcript = buildTranscript(allWords, {
        language: request.language,
        sampleRate: 16000,
        duration: info.duration
      })

      await writeTranscript(project.id, transcript, true, false)
      const updated = await loadProject(project.id)
      this.progress(job.id, 'done', 100, t('progress.done'))

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
