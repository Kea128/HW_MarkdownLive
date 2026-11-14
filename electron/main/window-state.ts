export interface Bounds {
  x?: number
  y?: number
  width: number
  height: number
}

export interface DisplayArea {
  x: number
  y: number
  width: number
  height: number
}

const MIN_WIDTH = 800
const MIN_HEIGHT = 560

/** `displays[0]` should be the primary display, used when the saved position is unknown or off screen. */
export function restoreBounds(saved: Partial<Bounds> | undefined, displays: DisplayArea[]): Bounds {
  const fit = (width: number, height: number, area: DisplayArea | undefined): Bounds => area
    ? { width: Math.max(MIN_WIDTH, Math.min(width, area.width)), height: Math.max(MIN_HEIGHT, Math.min(height, area.height)) }
    : { width, height }
  if (!saved || !Number.isFinite(saved.width) || !Number.isFinite(saved.height)) return fit(1280, 820, displays[0])

  const width = Math.max(MIN_WIDTH, Math.round(saved.width!))
  const height = Math.max(MIN_HEIGHT, Math.round(saved.height!))
  if (!Number.isFinite(saved.x) || !Number.isFinite(saved.y)) return fit(width, height, displays[0])

  const x = Math.round(saved.x!)
  const y = Math.round(saved.y!)
  const area = displays.find((display) => {
    const right = display.x + display.width
    const bottom = display.y + display.height
    return x < right - 80 && x + width > display.x + 80
      && y < bottom - 40 && y + height > display.y + 40
  })
  if (!area) return fit(width, height, displays[0])
  const size = fit(width, height, area)
  return {
    x: Math.max(area.x, Math.min(x, area.x + area.width - size.width)),
    y: Math.max(area.y, Math.min(y, area.y + area.height - size.height)),
    ...size,
  }
}
