import type { MermaidConfig } from 'mermaid'

type Mermaid = (typeof import('mermaid'))['default']
type ApplyPreview = (value: string | null) => void

const CACHE_LIMIT = 40
const VARIANTS: ReadonlyArray<{ name: string; theme: MermaidConfig['theme'] }> = [
  { name: 'light', theme: 'default' },
  { name: 'dark', theme: 'dark' },
]

let mermaidModule: Promise<Mermaid> | undefined
let queue: Promise<unknown> = Promise.resolve()
let pending = 0
let sequence = 0
const cache = new Map<string, string>()

export function isMermaidLanguage(language: string): boolean {
  return language.trim().toLowerCase() === 'mermaid'
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`)
}

function errorPreview(error: unknown): string {
  const message = (error instanceof Error ? error.message : String(error)).trim().slice(0, 800)
  return `<div class="mermaid-error" role="alert"><strong>Mermaid 图表无法渲染</strong><pre>${escapeHtml(message || '未知错误')}</pre></div>`
}

function loadMermaid(): Promise<Mermaid> {
  mermaidModule ??= import('mermaid').then(({ default: mermaid }) => mermaid, (error: unknown) => {
    mermaidModule = undefined
    throw error
  })
  return mermaidModule
}

async function renderDiagram(source: string): Promise<string> {
  const mermaid = await loadMermaid()
  try {
    await mermaid.parse(source)
  } catch (error) {
    return errorPreview(error)
  }
  const fontFamily = getComputedStyle(document.documentElement).getPropertyValue('--sans').trim() || 'sans-serif'
  const variants: string[] = []
  for (const { name, theme } of VARIANTS) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      suppressErrorRendering: true,
      fontFamily,
      theme,
    })
    try {
      const { svg } = await mermaid.render(`inkdown-mermaid-${++sequence}`, source)
      variants.push(`<div class="mermaid-variant mermaid-${name}">${svg}</div>`)
    } catch (error) {
      return errorPreview(error)
    }
  }
  return `<div class="mermaid-diagram">${variants.join('')}</div>`
}

function remember(source: string, html: string): string {
  cache.delete(source)
  cache.set(source, html)
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!)
  return html
}

export function renderMermaidPreview(source: string, applyPreview: ApplyPreview): string | undefined {
  const cached = cache.get(source)
  // Previews must reach the editor in request order, so a cached diagram may only skip an idle queue.
  if (cached !== undefined && pending === 0) return cached
  pending += 1
  const task = queue.then(async () => cached ?? remember(source, await renderDiagram(source)))
  queue = task.catch(() => undefined)
  void task
    .then(applyPreview, (error: unknown) => applyPreview(errorPreview(error)))
    .finally(() => { pending -= 1 })
  return undefined
}
