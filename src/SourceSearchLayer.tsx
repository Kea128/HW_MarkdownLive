import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, type CSSProperties, type ReactNode } from 'react'
import type { SearchMatch } from './search'

interface Props {
  text: string
  matches: SearchMatch[]
  current: number
  textarea: HTMLTextAreaElement
  scrollTop: number
  scrollLeft: number
}

/**
 * Chromium does not paint the selection of a textarea that has lost focus, so while the search field has focus the
 * matches are drawn on a layer behind the (transparent) textarea, line by line in its own font. Only visible lines
 * are rendered; source mode does not wrap, so every line is exactly one line-height tall.
 */
export function SourceSearchLayer({ text, matches, current, textarea, scrollTop, scrollLeft }: Props) {
  const layerRef = useRef<HTMLDivElement>(null)
  // A taller window shows more lines, which need their matches drawn too.
  const [, remeasure] = useReducer((count: number) => count + 1, 0)
  useEffect(() => {
    window.addEventListener('resize', remeasure)
    return () => window.removeEventListener('resize', remeasure)
  }, [])
  const lineStarts = useMemo(() => {
    const starts = [0]
    for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1)) starts.push(index + 1)
    return starts
  }, [text])
  const style = getComputedStyle(textarea)
  const lineHeight = Number.parseFloat(style.lineHeight) || 28
  const paddingTop = Number.parseFloat(style.paddingTop) || 0
  const paddingLeft = Number.parseFloat(style.paddingLeft) || 0
  const first = Math.max(0, Math.floor((scrollTop - paddingTop) / lineHeight))
  const last = Math.min(lineStarts.length - 1, first + Math.ceil(textarea.clientHeight / lineHeight) + 1)

  let next = 0
  while (next < matches.length && matches[next].end <= (lineStarts[first] ?? 0)) next += 1
  const lines: ReactNode[] = []
  for (let line = first; line <= last; line += 1) {
    const start = lineStarts[line]
    const end = line + 1 < lineStarts.length ? lineStarts[line + 1] - 1 : text.length
    const parts: ReactNode[] = []
    let cursor = start
    for (let index = next; index < matches.length && matches[index].start <= end; index += 1) {
      const from = Math.max(matches[index].start, start)
      const to = Math.min(matches[index].end, end)
      if (from > cursor) parts.push(text.slice(cursor, from))
      parts.push(
        <mark key={index} className={index === current ? 'is-current' : undefined}>{text.slice(from, to) || ' '}</mark>,
      )
      cursor = Math.max(cursor, to)
    }
    while (next < matches.length && matches[next].end <= end) next += 1
    if (cursor < end) parts.push(text.slice(cursor, end))
    lines.push(
      <div key={line} className="source-search-line" style={{ top: paddingTop + line * lineHeight - scrollTop, height: lineHeight }}>
        {parts}
      </div>,
    )
  }

  // The view does not wrap, so a match far to the right needs horizontal scrolling to be seen.
  useLayoutEffect(() => {
    const mark = layerRef.current?.querySelector<HTMLElement>('mark.is-current')
    if (!mark) return
    const x = paddingLeft + mark.offsetLeft
    const visible = textarea.clientWidth - paddingLeft
    if (x - paddingLeft < textarea.scrollLeft || x + mark.offsetWidth > textarea.scrollLeft + visible) {
      textarea.scrollLeft = Math.max(0, x - paddingLeft - visible / 3)
    }
  }, [current, matches, paddingLeft, textarea])

  const font: CSSProperties = {
    font: style.font,
    letterSpacing: style.letterSpacing,
    tabSize: style.tabSize as CSSProperties['tabSize'],
    lineHeight: `${lineHeight}px`,
  }
  return (
    <div ref={layerRef} className="source-search-layer" aria-hidden="true" style={font}>
      <div style={{ transform: `translateX(${paddingLeft - scrollLeft}px)` }}>{lines}</div>
    </div>
  )
}
