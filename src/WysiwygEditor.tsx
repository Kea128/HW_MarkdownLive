import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { languages } from '@codemirror/language-data'
import { Crepe } from '@milkdown/crepe'
import { replaceAll } from '@milkdown/kit/utils'
import { prepareEquationMarkdown, restoreEquationMarkdown } from './equations'
import { decorateEquationBlocks, hasEquationMutation } from './equation-decoration'
import { normalizeMathDelimiters } from './markdown'
import { mermaidLanguage } from './mermaid-language'
import { isMermaidLanguage, renderMermaidPreview } from './mermaid-preview'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame.css'
import 'katex/dist/katex.min.css'

interface Props {
  markdown: string
  onChange: (markdown: string) => void
}

const toEditorMarkdown = (markdown: string) =>
  prepareEquationMarkdown(normalizeMathDelimiters(markdown))

export default function WysiwygEditor({ markdown, onChange }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const crepeRef = useRef<Crepe | null>(null)
  const readyRef = useRef(false)
  const onChangeRef = useRef(onChange)
  const latestMarkdownRef = useRef(markdown)
  const editorMarkdownRef = useRef(toEditorMarkdown(markdown))
  const suppressedMarkdownRef = useRef<string | null>(
    restoreEquationMarkdown(editorMarkdownRef.current),
  )
  // Milkdown re-serializes loaded Markdown (table padding, escapes, list markers); an untouched
  // document must map back to the file content instead of being reported as an edit.
  const pristineRef = useRef<{ source: string; canonical: string } | null>(null)
  const [failed, setFailed] = useState(false)

  onChangeRef.current = onChange
  latestMarkdownRef.current = markdown

  const rememberPristine = (crepe: Crepe, source: string) => {
    pristineRef.current = { source, canonical: restoreEquationMarkdown(crepe.getMarkdown()) }
  }
  const toSourceMarkdown = (editorMarkdown: string) => {
    const restored = restoreEquationMarkdown(editorMarkdown)
    return restored === pristineRef.current?.canonical ? pristineRef.current.source : restored
  }

  useEffect(() => {
    const root = hostRef.current
    if (!root) return

    let disposed = false
    const initialMarkdown = toEditorMarkdown(latestMarkdownRef.current)
    editorMarkdownRef.current = initialMarkdown
    suppressedMarkdownRef.current = restoreEquationMarkdown(initialMarkdown)
    let decorationFrame: number | null = null
    const decorateEquations = () => {
      if (decorationFrame !== null) cancelAnimationFrame(decorationFrame)
      decorationFrame = requestAnimationFrame(() => {
        decorationFrame = null
        decorateEquationBlocks(root, editorMarkdownRef.current)
      })
    }
    const equationObserver = new MutationObserver((records) => {
      if (hasEquationMutation(records)) decorateEquations()
    })
    equationObserver.observe(root, { childList: true, subtree: true })
    const crepe = new Crepe({
      root,
      defaultValue: initialMarkdown,
      features: {
        [Crepe.Feature.Latex]: true,
        [Crepe.Feature.Table]: true,
        [Crepe.Feature.CodeMirror]: true,
        [Crepe.Feature.Toolbar]: true,
      },
      featureConfigs: {
        [Crepe.Feature.Placeholder]: {
          text: '开始写作…',
          mode: 'block',
        },
        [Crepe.Feature.BlockEdit]: {
          blockHandle: { getOffset: () => 6 },
        },
        [Crepe.Feature.CodeMirror]: {
          previewOnlyByDefault: true,
          languages: [...languages, mermaidLanguage],
          renderPreview: (language, content, applyPreview) => isMermaidLanguage(language) && content.trim()
            ? renderMermaidPreview(content, applyPreview)
            : null,
          copyText: '复制',
          previewToggleText: (previewOnly) => previewOnly ? '编辑' : '隐藏',
          previewLabel: '预览',
          previewLoading: '正在渲染图表…',
          searchPlaceholder: '搜索语言',
          noResultText: '没有匹配的语言',
        },
        [Crepe.Feature.Latex]: {
          katexOptions: {
            throwOnError: false,
            strict: 'warn',
            trust: false,
          },
        },
      },
    })
    crepeRef.current = crepe
    const publishCurrentMarkdown = () => {
      if (!readyRef.current) return
      const currentMarkdown = crepe.getMarkdown()
      editorMarkdownRef.current = currentMarkdown
      const sourceMarkdown = toSourceMarkdown(currentMarkdown)
      if (sourceMarkdown === latestMarkdownRef.current) return
      latestMarkdownRef.current = sourceMarkdown
      suppressedMarkdownRef.current = null
      onChangeRef.current(sourceMarkdown)
    }
    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, nextMarkdown) => {
        editorMarkdownRef.current = nextMarkdown
        const sourceMarkdown = toSourceMarkdown(nextMarkdown)
        latestMarkdownRef.current = sourceMarkdown
        decorateEquations()
        if (suppressedMarkdownRef.current === sourceMarkdown) {
          suppressedMarkdownRef.current = null
          return
        }
        suppressedMarkdownRef.current = null
        onChangeRef.current(sourceMarkdown)
      })
      listener.blur(publishCurrentMarkdown)
    })

    void crepe.create().then(() => {
      if (disposed) return
      readyRef.current = true
      const editor = root.querySelector<HTMLElement>('[contenteditable="true"]')
      editor?.setAttribute('aria-label', 'Markdown 所见即所得编辑器')
      editor?.setAttribute('role', 'textbox')
      editor?.setAttribute('aria-multiline', 'true')
      decorateEquations()

      const latest = toEditorMarkdown(latestMarkdownRef.current)
      if (latest !== editorMarkdownRef.current) {
        suppressedMarkdownRef.current = restoreEquationMarkdown(latest)
        editorMarkdownRef.current = latest
        crepe.editor.action(replaceAll(latest, true))
      }
      rememberPristine(crepe, latestMarkdownRef.current)
    }).catch(() => {
      if (!disposed) setFailed(true)
    })

    return () => {
      disposed = true
      publishCurrentMarkdown()
      readyRef.current = false
      crepeRef.current = null
      equationObserver.disconnect()
      if (decorationFrame !== null) cancelAnimationFrame(decorationFrame)
      void crepe.destroy()
    }
  }, [])

  useEffect(() => {
    const crepe = crepeRef.current
    if (!crepe || !readyRef.current) return
    const nextMarkdown = toEditorMarkdown(markdown)
    if (nextMarkdown === editorMarkdownRef.current) return

    suppressedMarkdownRef.current = restoreEquationMarkdown(nextMarkdown)
    editorMarkdownRef.current = nextMarkdown
    crepe.editor.action(replaceAll(nextMarkdown, true))
    rememberPristine(crepe, markdown)
  }, [markdown])

  const openExternalLink = (event: MouseEvent<HTMLDivElement>) => {
    const link = (event.target as Element).closest<HTMLAnchorElement>('a[href]')
    if (!link) return
    const href = link.getAttribute('href')
    if (href?.startsWith('#eq-')) {
      event.preventDefault()
      const target = document.getElementById(href.slice(1))
      if (!target) return
      const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
      target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' })
      target.classList.add('equation-target')
      window.setTimeout(() => target.classList.remove('equation-target'), 1_600)
      return
    }
    if (!/^(https?:|mailto:)/i.test(link.href)) return
    event.preventDefault()
    void window.inkdown.external.open(link.href)
  }

  if (failed) {
    return (
      <textarea
        className="visual-editor-fallback"
        aria-label="Markdown 源码"
        value={markdown}
        onChange={(event) => onChange(event.target.value)}
      />
    )
  }

  return (
    <div className="visual-editor" onClick={openExternalLink}>
      <div ref={hostRef} />
    </div>
  )
}
