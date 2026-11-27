import type { ExportField } from '@shared/types'

export const ROW_NUMBER_WIDTH = 56
export const MIN_COLUMN_WIDTH = 56
export const MAX_COLUMN_WIDTH = 900

/** Starting widths, tuned for the timecode and text columns of the CSV. */
export const DEFAULT_TABLE_COLUMN_WIDTHS: Record<ExportField, number> = {
  start_tc: 150,
  end_tc: 150,
  start_sec: 110,
  end_sec: 110,
  duration_sec: 120,
  type: 100,
  severity: 90,
  source: 90,
  confirmed: 110,
  text: 280,
  note: 220,
  cut: 80,
  defect_start_tc: 150,
  defect_end_tc: 150,
  defect_start_sec: 110,
  defect_end_sec: 110,
  defect_duration_sec: 140
}

export function normalizeColumnWidth(value: unknown): number | null {
  const number =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : Number.NaN
  if (!Number.isFinite(number)) return null
  return Math.round(Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, number)))
}

/** Reads persisted widths, dropping unknown fields and unusable values. */
export function normalizeColumnWidths(
  value: unknown
): Partial<Record<ExportField, number>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const next: Partial<Record<ExportField, number>> = {}
  for (const [field, width] of Object.entries(value as Record<string, unknown>)) {
    if (!(field in DEFAULT_TABLE_COLUMN_WIDTHS)) continue
    const normalized = normalizeColumnWidth(width)
    if (normalized !== null) next[field as ExportField] = normalized
  }
  return next
}

/** Full width map for the currently visible columns. */
export function columnWidthsFor(
  fields: ExportField[],
  stored: Partial<Record<ExportField, number>>
): Record<ExportField, number> {
  const next = { ...DEFAULT_TABLE_COLUMN_WIDTHS }
  for (const field of fields) {
    next[field] = stored[field] ?? DEFAULT_TABLE_COLUMN_WIDTHS[field]
  }
  return next
}

export function totalTableWidth(
  fields: ExportField[],
  widths: Record<ExportField, number>
): number {
  return fields.reduce((sum, field) => sum + widths[field], ROW_NUMBER_WIDTH)
}

/**
 * Columns an inline new row can edit. A timecode column wins over a seconds
 * column for the same edge; the note is edited only when its column is shown.
 */
export interface TableAddFields {
  start: ExportField | null
  end: ExportField | null
  note: ExportField | null
}

export function tableAddFields(fields: ExportField[]): TableAddFields {
  const pick = (...candidates: ExportField[]): ExportField | null =>
    candidates.find((field) => fields.includes(field)) ?? null
  return {
    start: pick('start_tc', 'start_sec'),
    end: pick('end_tc', 'end_sec'),
    note: pick('note')
  }
}
