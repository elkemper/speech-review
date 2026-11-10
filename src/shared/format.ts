export function formatTimecode(seconds: number, withMillis = false): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0)
  const totalMs = Math.round(safe * 1000)
  const ms = totalMs % 1000
  const totalSec = Math.floor(totalMs / 1000)
  const s = totalSec % 60
  const m = Math.floor(totalSec / 60) % 60
  const h = Math.floor(totalSec / 3600)
  const base = `${h > 0 ? `${h}:` : ''}${h > 0 ? String(m).padStart(2, '0') : m}:${String(s).padStart(2, '0')}`
  return withMillis ? `${base}.${String(ms).padStart(3, '0')}` : base
}

export function formatDuration(seconds: number): string {
  return formatTimecode(seconds)
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 Б'
  const units = ['Б', 'КБ', 'МБ', 'ГБ']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
