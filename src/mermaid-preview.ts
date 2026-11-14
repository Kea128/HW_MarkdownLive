import type { MermaidConfig } from 'mermaid'

type Mermaid = (typeof import('mermaid'))['default']
type ApplyPreview = (value: string | null) => void

const CACHE_LIMIT = 40

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

// Mermaid 12 gives some diagram types the colourful redux palette by default. Their dark counterpart is
// redux-dark-color, while every other diagram type pairs the `default` theme with `dark`.
function darkThemeConfig(mermaid: Mermaid): MermaidConfig {
  const sections = Object.entries(mermaid.mermaidAPI.defaultConfig).flatMap(([section, value]) =>
    (value as { theme?: unknown } | null)?.theme === 'redux-color' ? [[section, { theme: 'redux-dark-color' }]] : [])
  return { theme: 'dark', ...Object.fromEntries(sections) } as MermaidConfig
}

async function renderDiagram(source: string): Promise<string> {
  const mermaid = await loadMermaid()
  try {
    await mermaid.parse(source)
  } catch (error) {
    return errorPreview(error)
  }
  const fontFamily = getComputedStyle(document.documentElement).getPropertyValue('--sans').trim() || 'sans-serif'
  const themes: Array<[string, MermaidConfig]> = [['light', {}], ['dark', darkThemeConfig(mermaid)]]
  const variants: string[] = []
  for (const [name, themeConfig] of themes) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      suppressErrorRendering: true,
      fontFamily,
      ...themeConfig,
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

const TYPING_DELAY = 300
const typing = new WeakMap<Element, ReturnType<typeof setTimeout>>()

function enqueue(source: string, applyPreview: ApplyPreview): void {
  const cached = cache.get(source)
  pending += 1
  const task = queue.then(async () => cached ?? remember(source, await renderDiagram(source)))
  queue = task.catch(() => undefined)
  void task
    .then(applyPreview, (error: unknown) => applyPreview(errorPreview(error)))
    .finally(() => { pending -= 1 })
}

/**
 * `editing` is the code block the user is typing in. Each keystroke asked for a light and a dark render; while
 * typing, only the text that stays unchanged for a moment is drawn and the previous diagram remains visible.
 */
export function renderMermaidPreview(source: string, applyPreview: ApplyPreview, editing?: Element | null): string | undefined {
  const cached = cache.get(source)
  // Previews must reach the editor in request order, so a cached diagram may only skip an idle queue.
  if (cached !== undefined && pending === 0) return cached
  if (!editing) {
    enqueue(source, applyPreview)
    return undefined
  }
  clearTimeout(typing.get(editing))
  typing.set(editing, setTimeout(() => {
    typing.delete(editing)
    enqueue(source, applyPreview)
  }, TYPING_DELAY))
  return undefined
}
