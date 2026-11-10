import { app, BrowserWindow, dialog } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { formatTimecode } from '@shared/format'
import type { ExportRequest } from '@shared/types'

const TYPE_LABEL: Record<string, string> = {
  filler: 'филлер',
  pause: 'пауза',
  repetition: 'повтор',
  elongation: 'растяжка',
  false_start: 'обрыв',
  vocal_sound: 'звук',
  unclear: 'неразборчиво',
  manual: 'ручная метка'
}

const SEVERITY_LABEL: Record<string, string> = {
  low: 'низкая',
  medium: 'средняя',
  high: 'высокая'
}

function csvCell(value: string | number | boolean): string {
  const text = String(value)
  return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() || 'webinar'
}

export async function exportProject(
  window: BrowserWindow | null,
  request: ExportRequest
): Promise<string | null> {
  const { project, defects, marks, format } = request
  const filename = `${safeName(project.name)}-defects.${format}`
  const options = {
    title: 'Экспорт дефектов',
    defaultPath: join(app.getPath('downloads'), filename),
    filters:
      format === 'csv'
        ? [{ name: 'CSV', extensions: ['csv'] }]
        : [{ name: 'JSON', extensions: ['json'] }]
  }

  const result = window
    ? await dialog.showSaveDialog(window, options)
    : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return null

  if (format === 'csv') {
    const header = [
      'start_tc',
      'end_tc',
      'start_sec',
      'end_sec',
      'duration_sec',
      'type',
      'severity',
      'source',
      'reviewed',
      'text',
      'note'
    ]
    const lines = [header.join(';')]
    for (const defect of defects) {
      lines.push(
        [
          formatTimecode(defect.start, true),
          formatTimecode(defect.end, true),
          defect.start.toFixed(3),
          defect.end.toFixed(3),
          (defect.end - defect.start).toFixed(3),
          TYPE_LABEL[defect.type] ?? defect.type,
          SEVERITY_LABEL[defect.severity] ?? defect.severity,
          defect.source,
          defect.reviewed ? 'да' : 'нет',
          defect.text,
          defect.note
        ]
          .map(csvCell)
          .join(';')
      )
    }
    await writeFile(result.filePath, `\uFEFF${lines.join('\r\n')}\r\n`, 'utf8')
  } else {
    const payload = {
      exportedAt: new Date().toISOString(),
      project: {
        id: project.id,
        name: project.name,
        video: project.video.path,
        duration: project.duration,
        language: project.language,
        modelId: project.modelId,
        createdAt: project.createdAt
      },
      counts: defects.reduce<Record<string, number>>((accumulator, defect) => {
        accumulator[defect.type] = (accumulator[defect.type] ?? 0) + 1
        return accumulator
      }, {}),
      defects,
      marks
    }
    await writeFile(result.filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  }

  return result.filePath
}
