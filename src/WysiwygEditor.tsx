import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { LanguageDescription } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { Crepe } from '@milkdown/crepe'
import { commandsCtx, editorViewCtx, remarkStringifyOptionsCtx } from '@milkdown/kit/core'
import { blockService, type BlockService } from '@milkdown/kit/plugin/block'
import { clearTextInCurrentBlockCommand } from '@milkdown/kit/preset/commonmark'
import type { EditorView } from '@milkdown/kit/prose/view'
import { replaceAll } from '@milkdown/kit/utils'
import { ResponsiveBlockService } from './block-service'
import { keepInlineBreaks } from './editor-breaks'
import { prepareEquationMarkdown, restoreEquationMarkdown } from './equations'
import { FRONT_MATTER_LANGUAGE, prepareFrontMatter, restoreFrontMatter } from './front-matter'
import { IMAGE_MENU_ICON, insertImages, installImagePlugins } from './editor-images'
import { decorateEquationBlocks, hasEquationMutation } from './equation-decoration'
import { resolveImageSource } from './image-source'
import { normalizeMathDelimiters } from './markdown'
import { mermaidLanguage } from './mermaid-language'
import { isMermaidLanguage, renderMermaidPreview } from './mermaid-preview'
import { chooseImages, openImage, storeImages } from './paste-images'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame.css'
import 'katex/dist/katex.min.css'

export interface EditorApi {
  insertImages(): void
}

interface Props {
  markdown: string
  documentPath?: string | null
  onChange: (markdown: string) => void
  onNotice?: (message: string) => void
  onReady?: (api: EditorApi | null) => void
}

const toEditorMarkdown = (markdown: string) =>
  prepareEquationMarkdown(normalizeMathDelimiters(prepareFrontMatter(markdown)))
const fromEditorMarkdown = (markdown: string) => restoreFrontMatter(restoreEquationMarkdown(markdown))
const yamlLanguage = languages.find(({ name }) => name === 'YAML')
const frontMatterLanguage = yamlLanguage
  && LanguageDescription.of({ name: FRONT_MATTER_LANGUAGE, load: () => yamlLanguage.load() })

export default function WysiwygEditor({ markdown, documentPath = null, onChange, onNotice, onReady }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const crepeRef = useRef<Crepe | null>(null)
  const readyRef = useRef(false)
  const onChangeRef = useRef(onChange)
  const onNoticeRef = useRef(onNotice)
  const onReadyRef = useRef(onReady)
  const documentPathRef = useRef(documentPath)
  const latestMarkdownRef = useRef(markdown)
  const editorMarkdownRef = useRef(toEditorMarkdown(markdown))
  const suppressedMarkdownRef = useRef<string | null>(
    fromEditorMarkdown(editorMarkdownRef.current),
  )
  // Milkdown re-serializes loaded Markdown (table padding, escapes, list markers); an untouched
  // document must map back to the file content instead of being reported as an edit.
  const pristineRef = useRef<{ source: string; canonical: string } | null>(null)
  const [failed, setFailed] = useState(false)

  onChangeRef.current = onChange
  onNoticeRef.current = onNotice
  onReadyRef.current = onReady
  documentPathRef.current = documentPath
  latestMarkdownRef.current = markdown

  const rememberPristine = (crepe: Crepe, source: string) => {
    pristineRef.current = { source, canonical: fromEditorMarkdown(crepe.getMarkdown()) }
  }
  const toSourceMarkdown = (editorMarkdown: string) => {
    const restored = fromEditorMarkdown(editorMarkdown)
    return restored === pristineRef.current?.canonical ? pristineRef.current.source : restored
  }

  useEffect(() => {
    const root = hostRef.current
    if (!root) return

    let disposed = false
    const initialMarkdown = toEditorMarkdown(latestMarkdownRef.current)
    editorMarkdownRef.current = initialMarkdown
    suppressedMarkdownRef.current = fromEditorMarkdown(initialMarkdown)
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
    const notify = (message: string) => onNoticeRef.current?.(message)
    const chooseAndInsert = async (view: EditorView) => insertImages(view, await chooseImages(notify))
    const crepe = new Crepe({
      root,
      defaultValue: initialMarkdown,
      features: {
        [Crepe.Feature.Latex]: true,
        [Crepe.Feature.Table]: true,
        [Crepe.Feature.CodeMirror]: true,
        [Crepe.Feature.Toolbar]: true,
        // The image block stores its resize ratio in the alt text, overwriting Typora's alt on every save.
        [Crepe.Feature.ImageBlock]: false,
      },
      featureConfigs: {
        [Crepe.Feature.Placeholder]: {
          text: '开始写作…',
          mode: 'block',
        },
        [Crepe.Feature.BlockEdit]: {
          blockHandle: { getOffset: () => 6 },
          textGroup: {
            label: '文本',
            text: { label: '正文' },
            h1: { label: '一级标题' },
            h2: { label: '二级标题' },
            h3: { label: '三级标题' },
            h4: { label: '四级标题' },
            h5: { label: '五级标题' },
            h6: { label: '六级标题' },
            quote: { label: '引用' },
            divider: { label: '分隔线' },
          },
          listGroup: {
            label: '列表',
            bulletList: { label: '无序列表' },
            orderedList: { label: '有序列表' },
            taskList: { label: '任务列表' },
          },
          advancedGroup: {
            label: '插入',
            codeBlock: { label: '代码块' },
            table: { label: '表格' },
            math: { label: '公式' },
          },
          buildMenu: (builder) => {
            builder.getGroup('advanced').addItem('image', {
              label: '图片',
              icon: IMAGE_MENU_ICON,
              onRun: (ctx) => {
                ctx.get(commandsCtx).call(clearTextInCurrentBlockCommand.key)
                void chooseAndInsert(ctx.get(editorViewCtx))
              },
            })
          },
        },
        [Crepe.Feature.CodeMirror]: {
          previewOnlyByDefault: true,
          languages: [...languages, mermaidLanguage, ...(frontMatterLanguage ? [frontMatterLanguage] : [])],
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
    crepe.editor.config((ctx) => {
      ctx.set(blockService.key, () => new ResponsiveBlockService() as unknown as BlockService)
      // Keep Typora's and GitHub's list and rule markers so saving does not rewrite untouched lines.
      ctx.update(remarkStringifyOptionsCtx, (options) => ({ ...options, bullet: '-' as const, rule: '-' as const }))
    })
    keepInlineBreaks(crepe.editor)
    installImagePlugins(crepe.editor, {
      resolve: (source) => resolveImageSource(source, documentPathRef.current),
      store: (files) => storeImages(files, notify),
      choose: async () => (await chooseImages(notify))[0] ?? null,
      open: (src) => void openImage(src, notify),
      reveal: (src) => void window.inkdown.images.reveal(src).then((shown) => {
        if (!shown) notify('找不到图片文件')
      }),
      copy: (src) => void window.inkdown.images.copy(src).then((copied) => {
        notify(copied ? '图片已复制到剪贴板' : '无法复制这张图片')
      }),
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
        suppressedMarkdownRef.current = fromEditorMarkdown(latest)
        editorMarkdownRef.current = latest
        crepe.editor.action(replaceAll(latest, true))
      }
      rememberPristine(crepe, latestMarkdownRef.current)
      onReadyRef.current?.({
        insertImages: () => void chooseAndInsert(crepe.editor.action((ctx) => ctx.get(editorViewCtx))),
      })
    }).catch(() => {
      if (!disposed) setFailed(true)
    })

    return () => {
      disposed = true
      onReadyRef.current?.(null)
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

    suppressedMarkdownRef.current = fromEditorMarkdown(nextMarkdown)
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
