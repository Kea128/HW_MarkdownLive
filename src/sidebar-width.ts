export const SIDEBAR_WIDTH = { min: 180, default: 260, max: 600, storageKey: 'inkdown-sidebar-width' }

export function clampSidebarWidth(width: number, viewportWidth = window.innerWidth): number {
  const max = Math.max(SIDEBAR_WIDTH.min, Math.min(SIDEBAR_WIDTH.max, Math.floor(viewportWidth / 2)))
  return Math.round(Math.min(max, Math.max(SIDEBAR_WIDTH.min, width)))
}

export function readSidebarWidth(): number {
  const saved = Number(localStorage.getItem(SIDEBAR_WIDTH.storageKey))
  return saved > 0 ? clampSidebarWidth(saved, Number.POSITIVE_INFINITY) : SIDEBAR_WIDTH.default
}
