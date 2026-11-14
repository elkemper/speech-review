/**
 * Track background shared by the main and mini timelines so both render the
 * same shades. The kept room tone inside a pause is a neutral hatch: the track
 * background plus a slightly lighter version of it, never the defect color,
 * because that region will still be played.
 */
export const TRACK_BG = '#141619'
export const TRACK_BG_LIGHT = '#24272d'

/**
 * Diagonal hatch used for the gap between the original defect fill and the
 * final cut handles. Patterns are cached per canvas context because the
 * timeline redraws on every playhead tick.
 */
const cache = new WeakMap<CanvasRenderingContext2D, Map<string, CanvasPattern>>()

export function hatchPattern(
  ctx: CanvasRenderingContext2D,
  color: string,
  alpha: number,
  size = 6
): CanvasPattern | null {
  let patterns = cache.get(ctx)
  if (!patterns) {
    patterns = new Map()
    cache.set(ctx, patterns)
  }
  const key = `${color}|${alpha}|${size}`
  const cached = patterns.get(key)
  if (cached) return cached

  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const paint = canvas.getContext('2d')
  if (!paint) return null
  paint.strokeStyle = color
  paint.globalAlpha = alpha
  paint.lineWidth = 1
  paint.beginPath()
  paint.moveTo(-1, size + 1)
  paint.lineTo(size + 1, -1)
  paint.moveTo(-1, 1)
  paint.lineTo(1, -1)
  paint.moveTo(size - 1, size + 1)
  paint.lineTo(size + 1, size - 1)
  paint.stroke()

  const pattern = ctx.createPattern(canvas, 'repeat')
  if (pattern) patterns.set(key, pattern)
  return pattern
}
