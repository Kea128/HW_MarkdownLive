import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { LanguageDescription } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { Crepe } from '@milkdown/crepe'
import { commandsCtx, editorViewCtx, remarkCtx, remarkStringifyOptionsCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { codeBlockConfig } from '@milkdown/kit/component/code-block'
import { blockService, type BlockService } from '@milkdown/kit/plugin/block'
import { clearTextInCurrentBlockCommand, codeBlockSchema, setBlockTypeCommand } from '@milkdown/kit/preset/commonmark'
import { NodeSelection, TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { replaceAll } from '@milkdown/kit/utils'
import { ResponsiveBlockService } from './block-service'
import { applyDefaultCodeLanguage, plainTextLanguage } from './code-languages'
import { codeTheme } from './code-theme'
import { keepInlineBreaks } from './editor-breaks'
import { guardReadOnly } from './editor-guards'
import { prepareEquationMarkdown, restoreEquationMarkdown } from './equations'
import { FRONT_MATTER_LANGUAGE, prepareFrontMatter, restoreFrontMatter } from './front-matter'
import { IMAGE_MENU_ICON, insertImages, installImagePlugins } from './editor-images'
import { decorateEquationBlocks, hasEquationMutation } from './equation-decoration'
import { resolveImageSource } from './image-source'
import { keepLatexFences } from './latex-fences'
import { preserveLinkDefinitions } from './link-definitions'
import { normalizeMathDelimiters } from './markdown'
import { mermaidLanguage } from './mermaid-language'
import { isMermaidLanguage, renderMermaidPreview } from './mermaid-preview'
import { chooseImages, openImage, storeImages } from './paste-images'
import { revealAnchor, visualAnchor, type MarkdownBlock, type ViewAnchor } from './position-sync'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame.css'
import 'katex/dist/katex.min.css'

export interface EditorApi {
  insertImages(): void
  /** Reports edits Milkdown has not announced yet, so the source view opens on the final text. */
  flush(): void
  anchor(): ViewAnchor | null
  reveal(anchor: ViewAnchor): void
}

interface Props {
  markdown: string
  /** Changes when another document replaces this one; new text for the same document keeps the reading position. */
  documentId?: number
  documentPath?: string | null
  readOnly?: boolean
  /** Language for code blocks created from the slash menu or by typing ```. */
  codeLanguage?: string
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
const editingCodeBlock = () => document.activeElement?.closest('.milkdown-code-block') ?? null

export default function WysiwygEditor({
  markdown, documentId = 0, documentPath = null, readOnly = false, codeLanguage = '', onChange, onNotice, onReady,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const crepeRef = useRef<Crepe | null>(null)
  const readyRef = useRef(false)
  const onChangeRef = useRef(onChange)
  const onNoticeRef = useRef(onNotice)
  const onReadyRef = useRef(onReady)
  const documentPathRef = useRef(documentPath)
  const readOnlyRef = useRef(readOnly)
  const codeLanguageRef = useRef(codeLanguage)
  const latestMarkdownRef = useRef(markdown)
  /** The text the editor last reported or was given; the parent passing it back is not a change. */
  const reportedRef = useRef(markdown)
  /** The document whose text the editor shows, compared with `documentId` to tell a new document from an update. */
  const documentIdRef = useRef(documentId)
  const latestDocumentIdRef = useRef(documentId)
  const editorMarkdownRef = useRef(toEditorMarkdown(markdown))
  const suppressedMarkdownRef = useRef<string | null>(
    fromEditorMarkdown(editorMarkdownRef.current),
  )
  // Milkdown re-serializes loaded Markdown (table padding, escapes, list markers); an untouched
  // document must map back to the file content instead of being reported as an edit.
  const pristineRef = useRef<{ source: string; canonical: string } | null>(null)
  const sourceTreeRef = useRef<{ markdown: string; tree: MarkdownBlock } | null>(null)
  const replaceRef = useRef<(editorMarkdown: string, source: string, keepPosition: boolean) => void>(() => undefined)
  const linkHintRef = useRef(0)
  const [failed, setFailed] = useState(false)

  onChangeRef.current = onChange
  onNoticeRef.current = onNotice
  onReadyRef.current = onReady
  documentPathRef.current = documentPath
  readOnlyRef.current = readOnly
  codeLanguageRef.current = codeLanguage
  latestMarkdownRef.current = markdown
  latestDocumentIdRef.current = documentId

  const rememberPristine = (crepe: Crepe, source: string) => {
    pristineRef.current = { source, canonical: fromEditorMarkdown(crepe.getMarkdown()) }
  }
  const toSourceMarkdown = (editorMarkdown: string) => {
    const restored = fromEditorMarkdown(editorMarkdown)
    return restored === pristineRef.current?.canonical ? pristineRef.current.source : restored
  }
  /**
   * Block positions of the source text, parsed by the editor's own remark pipeline so blocks match its nodes.
   * Delimiters are normalised first (line numbers stay the same) because `\[…\]` math is one block in the editor.
   */
  const sourceTree = (ctx: Ctx, source: string) => {
    const markdown = normalizeMathDelimiters(prepareFrontMatter(source))
    if (sourceTreeRef.current?.markdown !== markdown) {
      sourceTreeRef.current = { markdown, tree: ctx.get(remarkCtx).parse(markdown) as unknown as MarkdownBlock }
    }
    return sourceTreeRef.current
  }

  useEffect(() => {
    const root = hostRef.current
    if (!root) return

    let disposed = false
    let createFailed = false
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
            const advanced = builder.getGroup('advanced')
            const codeItem = advanced.group.items.find(({ key }) => key === 'code')
            if (codeItem) {
              codeItem.onRun = (ctx) => {
                const commands = ctx.get(commandsCtx)
                commands.call(clearTextInCurrentBlockCommand.key)
                commands.call(setBlockTypeCommand.key, {
                  nodeType: codeBlockSchema.type(ctx),
                  attrs: { language: codeLanguageRef.current },
                })
              }
            }
            advanced.addItem('image', {
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
          // Crepe merges these options into its defaults index by index; null is the only theme that keeps One Dark out.
          theme: null as never,
          previewOnlyByDefault: true,
          languages: [...languages, mermaidLanguage, ...(frontMatterLanguage ? [frontMatterLanguage] : [])],
          renderPreview: (language, content, applyPreview) => isMermaidLanguage(language) && content.trim()
            ? renderMermaidPreview(content, applyPreview, editingCodeBlock())
            : null,
          copyText: '复制',
          onCopy: () => notify('代码已复制到剪贴板'),
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
      // Added after Crepe's merge: a shifted language list would have mixed each language's aliases into its neighbour.
      ctx.update(codeBlockConfig.key, (config) => ({
        ...config,
        languages: [plainTextLanguage, ...config.languages],
        extensions: [...config.extensions, codeTheme],
      }))
    })
    keepInlineBreaks(crepe.editor)
    preserveLinkDefinitions(crepe.editor)
    keepLatexFences(crepe.editor)
    applyDefaultCodeLanguage(crepe.editor, () => codeLanguageRef.current)
    guardReadOnly(crepe.editor)
    crepe.setReadonly(readOnlyRef.current)
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
    const report = (sourceMarkdown: string) => {
      latestMarkdownRef.current = sourceMarkdown
      reportedRef.current = sourceMarkdown
      onChangeRef.current(sourceMarkdown)
    }
    const publishCurrentMarkdown = () => {
      if (!readyRef.current) return
      const currentMarkdown = crepe.getMarkdown()
      editorMarkdownRef.current = currentMarkdown
      const sourceMarkdown = toSourceMarkdown(currentMarkdown)
      if (sourceMarkdown === latestMarkdownRef.current) return
      suppressedMarkdownRef.current = null
      report(sourceMarkdown)
    }
    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, nextMarkdown) => {
        editorMarkdownRef.current = nextMarkdown
        const sourceMarkdown = toSourceMarkdown(nextMarkdown)
        decorateEquations()
        if (suppressedMarkdownRef.current === sourceMarkdown) {
          suppressedMarkdownRef.current = null
          latestMarkdownRef.current = sourceMarkdown
          return
        }
        suppressedMarkdownRef.current = null
        report(sourceMarkdown)
      })
      listener.blur(publishCurrentMarkdown)
    })

    const scroller = () => root.closest<HTMLElement>('.visual-pane')
    replaceRef.current = (editorMarkdown, source, keepPosition) => {
      const pane = scroller()
      let anchor: ViewAnchor | null = null
      let hadFocus = false
      if (keepPosition && pane) {
        crepe.editor.action((ctx) => {
          const view = ctx.get(editorViewCtx)
          hadFocus = view.hasFocus()
          const { markdown: previous, tree } = sourceTree(ctx, toSourceMarkdown(editorMarkdownRef.current))
          anchor = visualAnchor(view, tree, previous, pane.getBoundingClientRect())
        })
      }
      suppressedMarkdownRef.current = fromEditorMarkdown(editorMarkdown)
      editorMarkdownRef.current = editorMarkdown
      // Read-only code blocks refuse new text, so a reload in reading mode would keep showing the old code.
      const readonly = crepe.readonly
      if (readonly) crepe.setReadonly(false)
      crepe.editor.action(replaceAll(editorMarkdown, true))
      if (readonly) crepe.setReadonly(true)
      rememberPristine(crepe, source)
      const target = anchor
      if (!target || !pane) return
      crepe.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        const { markdown: next, tree } = sourceTree(ctx, source)
        revealAnchor(view, tree, next, target, pane)
        if (!hadFocus || !view.editable) return
        const { scrollTop } = pane
        view.focus()
        pane.scrollTop = scrollTop
      })
    }

    void crepe.create().then(() => {
      if (disposed) return
      readyRef.current = true
      if (crepe.readonly !== readOnlyRef.current) crepe.setReadonly(readOnlyRef.current)
      crepe.editor.action((ctx) => {
        const editor = ctx.get(editorViewCtx).dom
        editor.setAttribute('aria-label', 'Markdown 所见即所得编辑器')
        editor.setAttribute('role', 'textbox')
        editor.setAttribute('aria-multiline', 'true')
        editor.setAttribute('aria-readonly', String(readOnlyRef.current))
      })
      decorateEquations()

      const latest = toEditorMarkdown(latestMarkdownRef.current)
      reportedRef.current = latestMarkdownRef.current
      documentIdRef.current = latestDocumentIdRef.current
      if (latest !== editorMarkdownRef.current) replaceRef.current(latest, latestMarkdownRef.current, false)
      else rememberPristine(crepe, latestMarkdownRef.current)
      onReadyRef.current?.({
        insertImages: () => void chooseAndInsert(crepe.editor.action((ctx) => ctx.get(editorViewCtx))),
        flush: publishCurrentMarkdown,
        anchor: () => crepe.editor.action((ctx) => {
          const pane = scroller()
          if (!pane || !readyRef.current) return null
          const { markdown: source, tree } = sourceTree(ctx, toSourceMarkdown(crepe.getMarkdown()))
          return visualAnchor(ctx.get(editorViewCtx), tree, source, pane.getBoundingClientRect())
        }),
        reveal: (anchor) => crepe.editor.action((ctx) => {
          const pane = scroller()
          if (!pane || !readyRef.current) return
          const view = ctx.get(editorViewCtx)
          const { markdown: source, tree } = sourceTree(ctx, latestMarkdownRef.current)
          revealAnchor(view, tree, source, anchor, pane)
          if (!view.editable) return
          const { scrollTop } = pane
          view.focus()
          pane.scrollTop = scrollTop
        }),
      })
    }).catch(() => {
      createFailed = true
      if (!disposed) setFailed(true)
    })

    return () => {
      disposed = true
      onReadyRef.current?.(null)
      publishCurrentMarkdown()
      readyRef.current = false
      crepeRef.current = null
      replaceRef.current = () => undefined
      equationObserver.disconnect()
      if (decorationFrame !== null) cancelAnimationFrame(decorationFrame)
      // Milkdown keeps retrying destroy() every 50 ms until creation finishes, which never happens after a failure.
      if (!createFailed) void crepe.destroy()
    }
  }, [])

  useEffect(() => {
    const sameDocument = documentIdRef.current === documentId
    documentIdRef.current = documentId
    if (!crepeRef.current || !readyRef.current || markdown === reportedRef.current) return
    reportedRef.current = markdown
    const nextMarkdown = toEditorMarkdown(markdown)
    if (nextMarkdown === editorMarkdownRef.current) return
    replaceRef.current(nextMarkdown, markdown, sameDocument)
  }, [documentId, markdown])

  useEffect(() => {
    const crepe = crepeRef.current
    if (!crepe || !readyRef.current || crepe.readonly === readOnly) return
    crepe.setReadonly(readOnly)
    crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dom.setAttribute('aria-readonly', String(readOnly))
      if (!readOnly) return
      // A selected image would keep its edit toolbar open.
      const { selection } = view.state
      if (selection instanceof NodeSelection) view.dispatch(view.state.tr.setSelection(TextSelection.near(selection.$from)))
      // Focus may sit inside a code block's CodeMirror rather than on the editor itself.
      const focused = document.activeElement
      if (focused instanceof HTMLElement && hostRef.current?.contains(focused)) focused.blur()
    })
  }, [readOnly])

  /** Reading mode follows links on click; while editing a click places the caret and Ctrl+click follows the link. */
  const openExternalLink = (event: MouseEvent<HTMLDivElement>) => {
    const link = (event.target as Element).closest<HTMLAnchorElement>('a[href]')
    if (!link) return
    if (!readOnly && !event.ctrlKey && !event.metaKey) {
      if (Date.now() - linkHintRef.current > 10_000) onNoticeRef.current?.('按住 Ctrl 单击可打开链接')
      linkHintRef.current = Date.now()
      return
    }
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
    <div className={`visual-editor${readOnly ? ' is-readonly' : ''}`} onClick={openExternalLink}>
      <div ref={hostRef} />
    </div>
  )
}
