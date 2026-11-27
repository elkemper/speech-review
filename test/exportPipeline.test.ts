import { describe, expect, it } from 'vitest'
import { DEFAULT_VIDEO_EXPORT_SETTINGS } from '../src/shared/settings'
import {
  ExportError,
  resolveExportJob,
  type ExportJob
} from '../src/main/engine/exportJob'
import {
  runExport,
  type ExportPorts,
  type ExportProgressEvent
} from '../src/main/engine/exportPipeline'

interface Recorder {
  calls: string[]
  filterText: string
  ports: ExportPorts
}

function recorder(overrides: Partial<ExportPorts> = {}): Recorder {
  const state: Recorder = {
    calls: [],
    filterText: '',
    ports: {
      createWorkDir: async () => {
        state.calls.push('workDir')
        return '/work'
      },
      writeText: async (path, text) => {
        state.calls.push(`write:${path}`)
        state.filterText = text
      },
      remove: async (path) => {
        state.calls.push(`remove:${path}`)
      },
      removeDir: async (path) => {
        state.calls.push(`removeDir:${path}`)
      },
      decodeAudio: async () => {
        state.calls.push('decode')
      },
      mixAudio: async () => {
        state.calls.push('mix')
      },
      render: async () => {
        state.calls.push('render')
      },
      move: async () => {
        state.calls.push('move')
      },
      fileSize: async () => 1024
    }
  }
  Object.assign(state.ports, overrides)
  return state
}

function job(overrides: Partial<ExportJob> = {}): ExportJob {
  const resolved = resolveExportJob({
    videoPath: '/media/source.mp4',
    outputPath: '/media/clean.mp4',
    temporaryPath: '/media/clean.part-1.mp4',
    cuts: [{ start: 2, end: 4 }],
    duration: 10,
    media: { hasVideo: true, hasAudio: true, fps: 25, sampleRate: 48000 },
    settings: DEFAULT_VIDEO_EXPORT_SETTINGS
  })
  if (!resolved.ok) throw new Error('fixture must resolve')
  return { ...resolved.job, ...overrides }
}

describe('export pipeline', () => {
  it('runs every stage in order and returns the output path', async () => {
    const state = recorder()
    const events: ExportProgressEvent[] = []
    const output = await runExport({
      job: job(),
      ports: state.ports,
      signal: new AbortController().signal,
      onProgress: (event) => events.push(event)
    })

    expect(output).toBe('/media/clean.mp4')
    expect(state.calls).toEqual([
      'workDir',
      'write:/work/filter.txt',
      'decode',
      'mix',
      'remove:/work/source.wav',
      'render',
      'move',
      'removeDir:/work'
    ])
    expect(state.filterText).toContain("select='between(n,0,49)+between(n,100,249)'")

    expect(events[0]).toMatchObject({ phase: 'prepare', step: 'decode', percent: 0 })
    expect(events[1]).toMatchObject({ phase: 'prepare', step: 'mix', percent: 0 })
    expect(events[events.length - 1]).toMatchObject({ phase: 'finalize', percent: 100 })
    expect(events.map((event) => event.percent)).toEqual([0, 0, 0, 100])
  })

  it('reports render progress monotonically and never reaches 100 early', async () => {
    const events: ExportProgressEvent[] = []
    const state = recorder({
      render: async (_args, _signal, onOutTime) => {
        onOutTime(0)
        onOutTime(1)
        onOutTime(4)
        onOutTime(4.5)
        onOutTime(40)
      }
    })

    await runExport({
      job: job(),
      ports: state.ports,
      signal: new AbortController().signal,
      onProgress: (event) => events.push(event)
    })

    const percents = events.map((event) => event.percent)
    expect(percents).toEqual([...percents].sort((a, b) => a - b))
    expect(Math.max(...percents)).toBe(100)
    expect(Math.max(...events.filter((event) => event.phase === 'render').map((e) => e.percent)))
      .toBeLessThanOrEqual(99)
  })

  it('removes the partial file and the work directory when rendering fails', async () => {
    const state = recorder({
      render: async () => {
        throw new ExportError('renderFailed', 'encoder exploded')
      }
    })

    await expect(
      runExport({
        job: job(),
        ports: state.ports,
        signal: new AbortController().signal,
        onProgress: () => undefined
      })
    ).rejects.toMatchObject({ code: 'renderFailed', details: 'encoder exploded' })

    expect(state.calls).toContain('remove:/media/clean.part-1.mp4')
    expect(state.calls).toContain('removeDir:/work')
    expect(state.calls).not.toContain('move')
  })

  it('wraps an unexpected port failure as a media failure', async () => {
    const state = recorder({
      mixAudio: async () => {
        throw new Error('disk gone')
      }
    })

    await expect(
      runExport({
        job: job(),
        ports: state.ports,
        signal: new AbortController().signal,
        onProgress: () => undefined
      })
    ).rejects.toMatchObject({ code: 'mediaFailed', details: 'disk gone' })

    expect(state.calls).toContain('remove:/media/clean.part-1.mp4')
    expect(state.calls).toContain('removeDir:/work')
  })

  it('returns null and leaves no output when cancelled mid-render', async () => {
    const controller = new AbortController()
    const state = recorder({
      render: async () => {
        controller.abort()
        throw new DOMException('Aborted', 'AbortError')
      }
    })

    const output = await runExport({
      job: job(),
      ports: state.ports,
      signal: controller.signal,
      onProgress: () => undefined
    })

    expect(output).toBeNull()
    expect(state.calls).toContain('remove:/media/clean.part-1.mp4')
    expect(state.calls).toContain('removeDir:/work')
    expect(state.calls).not.toContain('move')
  })

  it('refuses an empty output file', async () => {
    const state = recorder({ fileSize: async () => 0 })

    await expect(
      runExport({
        job: job(),
        ports: state.ports,
        signal: new AbortController().signal,
        onProgress: () => undefined
      })
    ).rejects.toMatchObject({ code: 'noOutput' })

    expect(state.calls).not.toContain('move')
    expect(state.calls).toContain('remove:/media/clean.part-1.mp4')
  })

  it('stops before rendering when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const state = recorder()

    const output = await runExport({
      job: job(),
      ports: state.ports,
      signal: controller.signal,
      onProgress: () => undefined
    })

    expect(output).toBeNull()
    expect(state.calls).toContain('removeDir:/work')
    expect(state.calls).not.toContain('mix')
    expect(state.calls).not.toContain('move')
  })
})
