import { app, BrowserWindow, dialog } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { buildCsv } from '@shared/exportCsv'
import type { ExportRequest } from '@shared/types'

function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() || 'webinar'
}

export async function exportProject(
  window: BrowserWindow | null,
  request: ExportRequest
): Promise<string | null> {
  const { project, defects, marks, format, exportSettings } = request
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
    await writeFile(result.filePath, buildCsv(defects, exportSettings), 'utf8')
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
