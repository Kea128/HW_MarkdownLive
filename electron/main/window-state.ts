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

export function restoreBounds(saved: Partial<Bounds> | undefined, displays: DisplayArea[]): Bounds {
  const fallback: Bounds = { width: 1280, height: 820 }
  if (!saved || !Number.isFinite(saved.width) || !Number.isFinite(saved.height)) return fallback

  const width = Math.max(MIN_WIDTH, Math.round(saved.width!))
  const height = Math.max(MIN_HEIGHT, Math.round(saved.height!))
  if (!Number.isFinite(saved.x) || !Number.isFinite(saved.y)) return { width, height }

  const x = Math.round(saved.x!)
  const y = Math.round(saved.y!)
  const visible = displays.some((display) => {
    const right = display.x + display.width
    const bottom = display.y + display.height
    return x < right - 80 && x + width > display.x + 80
      && y < bottom - 40 && y + height > display.y + 40
  })
  return visible ? { x, y, width, height } : { width, height }
}
