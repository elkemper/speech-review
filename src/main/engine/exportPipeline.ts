import { join } from 'node:path'
import { buildReencodeArgs, buildVideoFilterGraph, type ExportPiece } from '@shared/videoExport'
import { ExportError, type ExportJob } from './exportJob'

export type ExportPhase = 'prepare' | 'render' | 'finalize'
/** The two prepare steps; the caller turns them into its own wording. */
export type ExportStep = 'decode' | 'mix'

/** Language-neutral: the caller owns all user-facing text. */
export interface ExportProgressEvent {
  phase: ExportPhase
  step?: ExportStep
  percent: number
  processedSec: number
  totalSec: number
}

/**
 * Every side effect of an export, behind one seam. The real implementation
 * spawns ffmpeg and touches the disk; the test doubles record calls, so the
 * ordering, cleanup and cancellation of the pipeline can be asserted without
 * media or processes.
 */
export interface ExportPorts {
  createWorkDir(): Promise<string>
  writeText(path: string, text: string): Promise<void>
  /** Removes a file; missing files are not an error. */
  remove(path: string): Promise<void>
  /** Removes the work directory recursively. */
  removeDir(path: string): Promise<void>
  decodeAudio(
    input: string,
    output: string,
    sampleRate: number,
    signal: AbortSignal
  ): Promise<void>
  mixAudio(options: {
    wav: string
    output: string
    pieces: ExportPiece[]
    totalFrames: number
    signal: AbortSignal
  }): Promise<void>
  /** Runs ffmpeg and reports the output position from `-progress pipe:1`. */
  render(
    args: string[],
    signal: AbortSignal,
    onOutTime: (seconds: number) => void
  ): Promise<void>
  move(from: string, to: string): Promise<void>
  /** Size in bytes, or 0 when the file does not exist. */
  fileSize(path: string): Promise<number>
}

export interface ExportRunOptions {
  job: ExportJob
  ports: ExportPorts
  signal: AbortSignal
  onProgress: (event: ExportProgressEvent) => void
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

/**
 * Run one export: filter script, pre-cut PCM audio, one re-encode pass, then
 * an atomic rename. Returns the written path, or `null` when the caller
 * cancelled; a cancelled or failed run leaves no partial output behind.
 */
export async function runExport({
  job,
  ports,
  signal,
  onProgress
}: ExportRunOptions): Promise<string | null> {
  const { plan, settings, totalSec, temporaryPath, outputPath } = job
  const workDir = await ports.createWorkDir()

  try {
    const filterScript = join(workDir, 'filter.txt')
    await ports.writeText(filterScript, buildVideoFilterGraph(plan, settings.resolution))

    // The audio is decoded and cut once, here, so the filter graph only walks
    // the video. Both sides follow the same plan, which is what keeps the
    // tracks the same length at any number of cuts.
    const sourceWav = join(workDir, 'source.wav')
    const cutWav = join(workDir, 'audio.wav')

    onProgress({ phase: 'prepare', step: 'decode', percent: 0, processedSec: 0, totalSec })
    await ports.decodeAudio(job.videoPath, sourceWav, plan.sampleRate, signal)
    if (signal.aborted) return null

    onProgress({ phase: 'prepare', step: 'mix', percent: 0, processedSec: 0, totalSec })
    await ports.mixAudio({
      wav: sourceWav,
      output: cutWav,
      pieces: plan.pieces,
      totalFrames: plan.audioSamples,
      signal
    })
    await ports.remove(sourceWav).catch(() => undefined)
    if (signal.aborted) return null

    const args = buildReencodeArgs({
      input: job.videoPath,
      audioInput: cutWav,
      output: temporaryPath,
      filterScriptPath: filterScript,
      settings,
      fps: plan.fps
    })

    onProgress({ phase: 'render', percent: 0, processedSec: 0, totalSec })
    let lastPercent = -1
    await ports.render(args, signal, (processedSec) => {
      const percent =
        totalSec > 0
          ? Math.max(0, Math.min(99, Math.floor((processedSec / totalSec) * 100)))
          : 0
      if (percent === lastPercent) return
      lastPercent = percent
      onProgress({ phase: 'render', percent, processedSec, totalSec })
    })
    if (signal.aborted) return null

    if ((await ports.fileSize(temporaryPath)) <= 0) throw new ExportError('noOutput')
    await ports.move(temporaryPath, outputPath)

    onProgress({ phase: 'finalize', percent: 100, processedSec: totalSec, totalSec })
    return outputPath
  } catch (error) {
    await ports.remove(temporaryPath).catch(() => undefined)
    if (signal.aborted || isAbort(error)) return null
    if (error instanceof ExportError) throw error
    throw new ExportError('mediaFailed', error instanceof Error ? error.message : String(error))
  } finally {
    await ports.removeDir(workDir).catch(() => undefined)
  }
}
