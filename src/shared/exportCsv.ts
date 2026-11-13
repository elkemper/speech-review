import type { Defect, ExportField, ExportSettings } from './types'

/** CSV consumers expect a fixed-width timecode, including leading zero hours. */
export function exportTimecode(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0)
  const totalMs = Math.round(safe * 1000)
  const ms = totalMs % 1000
  const totalSec = Math.floor(totalMs / 1000)
  const s = totalSec % 60
  const m = Math.floor(totalSec / 60) % 60
  const h = Math.floor(totalSec / 3600)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}.${String(ms).padStart(3, '0')}`
}

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

export function csvCell(value: string | number | boolean): string {
  const text = String(value)
  return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function exportValue(defect: Defect, field: ExportField): string | number | boolean {
  switch (field) {
    case 'start_tc':
      return exportTimecode(defect.start)
    case 'end_tc':
      return exportTimecode(defect.end)
    case 'start_sec':
      return defect.start.toFixed(3)
    case 'end_sec':
      return defect.end.toFixed(3)
    case 'duration_sec':
      return (defect.end - defect.start).toFixed(3)
    case 'type':
      return TYPE_LABEL[defect.type] ?? defect.type
    case 'severity':
      return SEVERITY_LABEL[defect.severity] ?? defect.severity
    case 'source':
      return defect.source
    case 'confirmed':
      return defect.confirmed ? 'да' : 'нет'
    case 'text':
      return defect.text
    case 'note':
      return defect.note
    default:
      return ''
  }
}

export function buildCsv(defects: Defect[], settings: ExportSettings): string {
  const fields = settings.fields.length > 0 ? settings.fields : (['start_tc'] as ExportField[])
  const delimiter = settings.delimiter === ',' ? ',' : ';'
  const lines: string[] = []
  if (settings.includeHeader) lines.push(fields.join(delimiter))
  for (const defect of defects) {
    lines.push(
      fields.map((field) => csvCell(exportValue(defect, field))).join(delimiter)
    )
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`
}
