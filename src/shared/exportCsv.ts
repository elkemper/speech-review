import type { ExportDefect, ExportField, ExportSettings } from './types'

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

function cutBounds(defect: ExportDefect): { start: number; end: number } | null {
  if (defect.cutStart === null || defect.cutEnd === null) return null
  if (!Number.isFinite(defect.cutStart) || !Number.isFinite(defect.cutEnd)) return null
  if (defect.cutEnd <= defect.cutStart) return null
  return { start: defect.cutStart, end: defect.cutEnd }
}

function cutValue(defect: ExportDefect, format: (seconds: number) => string): string {
  const cut = cutBounds(defect)
  return cut ? format(cut.start) : ''
}

function cutDuration(defect: ExportDefect): string {
  const cut = cutBounds(defect)
  return cut ? (cut.end - cut.start).toFixed(3) : ''
}

export function exportValue(defect: ExportDefect, field: ExportField): string | number | boolean {
  switch (field) {
    case 'start_tc':
      return cutValue(defect, exportTimecode)
    case 'end_tc': {
      const cut = cutBounds(defect)
      return cut ? exportTimecode(cut.end) : ''
    }
    case 'start_sec':
      return cutValue(defect, (value) => value.toFixed(3))
    case 'end_sec': {
      const cut = cutBounds(defect)
      return cut ? cut.end.toFixed(3) : ''
    }
    case 'duration_sec':
      return cutDuration(defect)
    case 'cut':
      return cutBounds(defect) ? 'да' : 'нет'
    case 'defect_start_tc':
      return exportTimecode(defect.start)
    case 'defect_end_tc':
      return exportTimecode(defect.end)
    case 'defect_start_sec':
      return defect.start.toFixed(3)
    case 'defect_end_sec':
      return defect.end.toFixed(3)
    case 'defect_duration_sec':
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

export function buildCsv(defects: ExportDefect[], settings: ExportSettings): string {
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
