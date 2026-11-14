import {
  lazy, Suspense, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type DragEvent, type KeyboardEvent,
} from 'react'
import {
  Bold, BookOpen, Braces, CheckSquare, Code2, Eye, FilePlus2, FolderOpen, FolderTree,
  Image, Italic, Link, List, ListOrdered, MessageSquarePlus, Minus, Moon, PanelLeftClose, PanelLeftOpen,
  Quote, Save, SaveAll, Settings, Sigma, Strikethrough, Sun, Table2, Text, Workflow,
} from 'lucide-react'
import { createEquationLabel, getEquationDefinitions } from './equations'
import { FeedbackDialog } from './FeedbackDialog'
import { useDesktopDocument } from './hooks/useDesktopDocument'
import { usePreferences } from './hooks/usePreferences'
import { useSourceEditorActions } from './hooks/useSourceEditorActions'
import { useWorkspace } from './hooks/useWorkspace'
import { markdownOutline, type OutlineItem } from './outline'
import {
  chooseImages, draggingImages, imageFiles, imageMarkdown, shouldPasteImages, storeImages, type StoredImage,
} from './paste-images'
import {
  lineAtOffset, offsetAtLine, sourceAnchor, sourceScrollTop, type SourceMetrics, type ViewAnchor,
} from './position-sync'
import { contentWidthCss, LINE_SPACINGS } from './preferences'
import { SettingsDialog } from './SettingsDialog'
import { Sidebar, type SidebarView } from './Sidebar'
import { readSidebarWidth, SIDEBAR_WIDTH } from './sidebar-width'
import { getDocumentStats } from './utils'
import type { EditorMode, LineSpacing, SettingsSection, Theme, UpdateState } from './contracts'
import type { EditorApi } from './WysiwygEditor'
import './App.css'

const WysiwygEditor = lazy(() => import('./WysiwygEditor'))
const SOURCE_LINE_HEIGHT = 28
const SOURCE_PADDING_TOP = 46
const AUTO_SAVE_DELAY = 1_000
const DOCUMENT_FILE = /\.(?:md|markdown|txt)$/i
const MERMAID_SAMPLE = 'flowchart LR\n  A[开始] --> B{是否完成？}\n  B -- 是 --> C[发布]\n  B -- 否 --> D[继续修改]'

const modes: Array<{ mode: EditorMode; label: string; title: string; icon: typeof Eye }> = [
  { mode: 'visual', label: '所见即所得', title: '所见即所得', icon: Eye },
  { mode: 'source', label: '源码', title: '源码', icon: Text },
  { mode: 'reading', label: '阅读', title: '阅读（只读）', icon: BookOpen },
]

function describeUpdate(state: UpdateState): string | null {
  if (state.phase === 'checking') return '正在检查更新…'
  if (state.phase === 'downloading') return `正在下载 v${state.version}（${Math.floor(state.percent)}%）`
  if (state.phase === 'downloaded') return `v${state.version} 已下载，退出时自动安装`
  return null
}

/** The narrow-window layout changes the source padding, so it is read from the textarea itself. */
function sourceMetrics(textarea: HTMLTextAreaElement): SourceMetrics {
  const style = getComputedStyle(textarea)
  const lineHeight = Number.parseFloat(style.lineHeight)
  const paddingTop = Number.parseFloat(style.paddingTop)
  return {
    lineHeight: lineHeight > 0 ? lineHeight : SOURCE_LINE_HEIGHT,
    paddingTop: Number.isFinite(paddingTop) ? paddingTop : SOURCE_PADDING_TOP,
  }
}

const isDark = (theme: Theme) => theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
const draggingDocuments = (event: DragEvent) =>
  Array.from(event.dataTransfer.items).some((item) => item.kind === 'file' && !item.type.startsWith('image/'))

function App() {
  const editorApi = useRef<EditorApi | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const showNotice = useCallback((message: string) => {
    clearTimeout(noticeTimer.current)
    setNotice(message)
    noticeTimer.current = setTimeout(() => setNotice(null), 5_000)
  }, [])
  const {
    document: activeDocument, status, saveProblem, updateContent, newDocument, openDocument,
    openPath, saveDocument, autoSaveDocument, saveAsDocument, closeDocument,
  } = useDesktopDocument({ flushEditor: () => editorApi.current?.flush(), onNotice: showNotice })
  const { preferences, loaded: preferencesLoaded, update: updatePreferences } = usePreferences()
  const [mode, setMode] = useState<EditorMode>('visual')
  const [theme, setTheme] = useState<Theme>('system')
  const [dark, setDark] = useState(false)
  const [updateState, setUpdateState] = useState<UpdateState>({ phase: 'idle' })
  const updateMessage = describeUpdate(updateState)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarView, setSidebarView] = useState<SidebarView>('outline')
  const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [settingsSection, setSettingsSection] = useState<SettingsSection | null>(null)
  const dialogOpen = feedbackOpen || settingsSection !== null
  const dialogOpenRef = useRef(dialogOpen)
  dialogOpenRef.current = dialogOpen
  const modeRef = useRef(mode)
  modeRef.current = mode
  const lastRichMode = useRef<Exclude<EditorMode, 'source'>>('visual')
  const pendingAnchor = useRef<ViewAnchor | null>(null)
  const { workspace, openFolder, refreshFolder, closeFolder } = useWorkspace(() => {
    setSidebarOpen(true)
    setSidebarView('files')
  })
  const [currentLine, setCurrentLine] = useState(1)
  const [composing, setComposing] = useState(false)
  const themeRef = useRef<Theme>('system')
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const lineNumbersRef = useRef<HTMLDivElement>(null)
  const sourceSelection = useRef({ start: 0, end: 0, scrollTop: 0 })
  const typedContent = useRef<string | null>(null)
  const lastSourceRender = useRef<{ documentId: number } | null>(null)
  const tabEscape = useRef(false)
  // Derived panels follow the text a frame later so typing in long documents is not blocked by them.
  const deferredContent = useDeferredValue(activeDocument.content)
  const stats = useMemo(() => getDocumentStats(deferredContent), [deferredContent])
  const lineNumbers = useMemo(() => Array.from({ length: stats.lines }, (_, index) => index + 1).join('\n'), [stats.lines])
  const equations = useMemo(() => getEquationDefinitions(deferredContent), [deferredContent])
  const outline = useMemo(() => markdownOutline(deferredContent), [deferredContent])
  const {
    applyFormat, applyHeading, applyBlockFormat, applyLinePrefix, indent, insertLiteral,
  } = useSourceEditorActions({
    editorRef,
    content: activeDocument.content,
    updateContent,
  })
  const insertLiteralRef = useRef(insertLiteral)
  insertLiteralRef.current = insertLiteral

  const insertSourceMarkdown = (images: StoredImage[]) => {
    if (images.length) insertLiteralRef.current(images.map(imageMarkdown).join('\n'))
  }
  const insertSourceImages = async (files: File[]) => insertSourceMarkdown(await storeImages(files, showNotice))
  const insertImageRef = useRef(() => {})
  insertImageRef.current = () => {
    if (dialogOpenRef.current) return
    if (modeRef.current === 'reading') showNotice('阅读模式下不能编辑，按 Ctrl+1 回到所见即所得后再插入图片')
    else if (modeRef.current === 'source') void chooseImages(showNotice).then(insertSourceMarkdown)
    else editorApi.current?.insertImages()
  }

  const modeChosen = useRef(false)
  // Switching between the source and rendered views keeps the caret line and its place on screen.
  const switchMode = useCallback((requested: EditorMode | 'toggle') => {
    if (dialogOpenRef.current) return
    modeChosen.current = true
    const current = modeRef.current
    const next = requested === 'toggle' ? (current === 'source' ? lastRichMode.current : 'source') : requested
    if (next === current) return
    if (current === 'source') {
      const textarea = editorRef.current
      pendingAnchor.current = textarea ? sourceAnchor(textarea, sourceMetrics(textarea)) : null
    } else if (next === 'source') {
      editorApi.current?.flush()
      // A rendered view that is still loading keeps the anchor the source view left.
      pendingAnchor.current = editorApi.current?.anchor() ?? pendingAnchor.current
    }
    if (next !== 'source') lastRichMode.current = next
    modeRef.current = next
    setMode(next)
  }, [])

  // Text replaced from outside (a save rewriting image links, a reload) keeps the caret; another document starts at the top.
  useLayoutEffect(() => {
    const editor = editorRef.current
    if (mode !== 'source' || !editor) {
      lastSourceRender.current = null
      return
    }
    const previous = lastSourceRender.current
    lastSourceRender.current = { documentId: activeDocument.documentId }
    if (!previous || activeDocument.content === typedContent.current) return
    const replaced = previous.documentId !== activeDocument.documentId
    const { start, end, scrollTop } = replaced ? { start: 0, end: 0, scrollTop: 0 } : sourceSelection.current
    const length = editor.value.length
    editor.setSelectionRange(Math.min(start, length), Math.min(end, length))
    editor.scrollTop = scrollTop
    if (lineNumbersRef.current) lineNumbersRef.current.scrollTop = editor.scrollTop
    setCurrentLine(lineAtOffset(editor.value, Math.min(start, length)))
  }, [activeDocument.content, activeDocument.documentId, mode])

  useLayoutEffect(() => {
    const anchor = pendingAnchor.current
    const textarea = editorRef.current
    if (mode !== 'source' || !anchor || !textarea) return
    pendingAnchor.current = null
    const offset = offsetAtLine(textarea.value, anchor.line)
    textarea.focus({ preventScroll: true })
    textarea.setSelectionRange(offset, offset)
    textarea.scrollTop = sourceScrollTop(anchor, textarea.clientHeight, sourceMetrics(textarea))
    if (lineNumbersRef.current) lineNumbersRef.current.scrollTop = textarea.scrollTop
    sourceSelection.current = { start: offset, end: offset, scrollTop: textarea.scrollTop }
    setCurrentLine(anchor.line)
  }, [mode])

  const editorReady = useCallback((api: EditorApi | null) => {
    editorApi.current = api
    const anchor = pendingAnchor.current
    if (!api || !anchor) return
    pendingAnchor.current = null
    requestAnimationFrame(() => api.reveal(anchor))
  }, [])

  const applyTheme = useCallback((value: Theme) => {
    themeRef.current = value
    setTheme(value)
    const resolved = isDark(value)
    setDark(resolved)
    document.documentElement.dataset.theme = resolved ? 'dark' : 'light'
    document.documentElement.style.colorScheme = resolved ? 'dark' : 'light'
  }, [])

  useEffect(() => {
    applyTheme(themeRef.current)
    const unMode = window.inkdown.view.onMode(switchMode)
    const unTheme = window.inkdown.view.onTheme(applyTheme)
    const media = matchMedia('(prefers-color-scheme: dark)')
    const systemChanged = () => { if (themeRef.current === 'system') applyTheme('system') }
    media.addEventListener('change', systemChanged)
    return () => {
      unMode()
      unTheme()
      media.removeEventListener('change', systemChanged)
    }
  }, [applyTheme, switchMode])

  useEffect(() => {
    if (preferencesLoaded) applyTheme(preferences.theme)
  }, [applyTheme, preferences.theme, preferencesLoaded])

  useEffect(() => {
    if (preferencesLoaded && !modeChosen.current) switchMode(preferences.startupMode)
  }, [preferences.startupMode, preferencesLoaded, switchMode])

  useEffect(() => {
    const start = () => setComposing(true)
    const end = () => setComposing(false)
    document.addEventListener('compositionstart', start, true)
    document.addEventListener('compositionend', end, true)
    return () => {
      document.removeEventListener('compositionstart', start, true)
      document.removeEventListener('compositionend', end, true)
    }
  }, [])

  // Waits for an input method to finish, so a pause on the candidate list does not write half-typed pinyin to disk.
  useEffect(() => {
    if (!preferences.autoSave || composing || !activeDocument.dirty || !activeDocument.filePath) return
    const timer = setTimeout(() => void autoSaveDocument(), AUTO_SAVE_DELAY)
    return () => clearTimeout(timer)
  }, [activeDocument.content, activeDocument.dirty, activeDocument.filePath, autoSaveDocument, composing, preferences.autoSave])

  useEffect(() => {
    // Captured before CodeMirror, whose Ctrl+/ would also comment out the current line of a code block.
    const toggleSource = (event: globalThis.KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || (event.code !== 'Slash' && event.key !== '/')) return
      event.preventDefault()
      event.stopPropagation()
      switchMode('toggle')
    }
    window.addEventListener('keydown', toggleSource, true)
    return () => window.removeEventListener('keydown', toggleSource, true)
  }, [switchMode])

  useEffect(() => window.inkdown.updates.onState(setUpdateState), [])
  useEffect(() => window.inkdown.feedback.onShow(() => setFeedbackOpen(true)), [])
  useEffect(() => window.inkdown.settings.onShow((section) => setSettingsSection(section ?? 'appearance')), [])

  const changeSidebarWidth = useCallback((width: number) => {
    setSidebarWidth(width)
    localStorage.setItem(SIDEBAR_WIDTH.storageKey, String(width))
  }, [])
  const openFolderAction = useCallback(() => void openFolder(), [openFolder])
  const refreshFolderAction = useCallback(() => void refreshFolder(), [refreshFolder])
  const closeFolderAction = useCallback(() => void closeFolder(), [closeFolder])
  const openFileAction = useCallback((filePath: string) => void openPath(filePath), [openPath])

  const selectOutline = useCallback((item: OutlineItem) => {
    const editor = editorRef.current
    if (!editor) {
      editorApi.current?.reveal({ line: item.line, ratio: 0.08 })
      return
    }
    editor.focus({ preventScroll: true })
    editor.setSelectionRange(item.offset, item.offset)
    editor.scrollTop = sourceScrollTop({ line: item.line, ratio: 0.08 }, editor.clientHeight, sourceMetrics(editor))
    if (lineNumbersRef.current) lineNumbersRef.current.scrollTop = editor.scrollTop
    sourceSelection.current = { start: item.offset, end: item.offset, scrollTop: editor.scrollTop }
    setCurrentLine(item.line)
  }, [])

  const handleEditorKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const plain = (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey
    const escapeArmed = tabEscape.current
    tabEscape.current = event.key === 'Escape'
    if (plain && event.key.toLowerCase() === 'b') {
      event.preventDefault()
      applyFormat('**', '**', '粗体')
    } else if (plain && event.key.toLowerCase() === 'i') {
      event.preventDefault()
      applyFormat('*', '*', '斜体')
    } else if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey && !escapeArmed) {
      // Esc then Tab leaves the editor for keyboard users.
      event.preventDefault()
      indent(event.shiftKey)
    }
  }

  const updateCurrentLine = () => {
    const editor = editorRef.current
    if (!editor) return
    sourceSelection.current = { start: editor.selectionStart, end: editor.selectionEnd, scrollTop: editor.scrollTop }
    setCurrentLine(lineAtOffset(editor.value, editor.selectionStart))
  }

  const dragEnter = (event: DragEvent) => {
    if (!draggingDocuments(event)) return
    dragDepth.current += 1
    setDragging(true)
  }
  const dragLeave = () => {
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragging(false)
  }
  const drop = (event: DragEvent) => {
    dragDepth.current = 0
    setDragging(false)
    const file = event.dataTransfer.files[0]
    if (!file || file.type.startsWith('image/')) return
    event.preventDefault()
    if (!DOCUMENT_FILE.test(file.name)) {
      showNotice('只能打开 .md、.markdown 或 .txt 文件')
      return
    }
    const filePath = window.inkdown.document.pathForFile(file)
    if (filePath) void openPath(filePath)
  }

  useEffect(() => window.inkdown.document.onCommand((command) => {
    if (command.action === 'new') void newDocument()
    else if (command.action === 'open') void openDocument()
    else if (command.action === 'openPath') void openPath(command.filePath)
    else if (command.action === 'save') void saveDocument()
    else if (command.action === 'saveAs') void saveAsDocument()
    else if (command.action === 'insertImage') insertImageRef.current()
    else void closeDocument()
  }), [
    closeDocument, newDocument, openDocument, openPath, saveAsDocument, saveDocument,
  ])

  const statusMessage = notice ?? status
  return (
    <div
      className={`app mode-${mode} ${dragging ? 'is-dragging' : ''}`}
      data-line-spacing={preferences.lineSpacing}
      style={{
        '--editor-font-size': `${preferences.fontSize}px`,
        '--content-width': contentWidthCss(preferences.contentWidth),
      } as CSSProperties}
      onDragEnter={dragEnter}
      onDragOver={(event) => { if (draggingDocuments(event)) event.preventDefault() }}
      onDragLeave={dragLeave}
      onDrop={drop}
    >
      <header className="topbar">
        <nav className="document-actions" aria-label="文档操作">
          <button type="button" onClick={() => setSidebarOpen((open) => !open)}
            title={sidebarOpen ? '收起侧栏' : '展开侧栏'} aria-label={sidebarOpen ? '收起侧栏' : '展开侧栏'}>
            {sidebarOpen ? <PanelLeftClose /> : <PanelLeftOpen />}
          </button>
          <span className="action-divider" />
          <button type="button" onClick={() => void newDocument()} title="新建 (Ctrl+N)" aria-label="新建文档"><FilePlus2 /></button>
          <button type="button" onClick={() => void openDocument()} title="打开 (Ctrl+O)" aria-label="打开文档"><FolderOpen /></button>
          <button type="button" onClick={openFolderAction} title="打开文件夹 (Ctrl+Shift+O)" aria-label="打开文件夹"><FolderTree /></button>
          <button type="button" onClick={() => void saveDocument()} title="保存 (Ctrl+S)" aria-label="保存文档"><Save /></button>
          <button type="button" onClick={() => void saveAsDocument()} title="另存为 (Ctrl+Shift+S)" aria-label="另存为"><SaveAll /></button>
        </nav>
        <div className="title-area">
          <span className="title-name">{activeDocument.fileName}</span>
          {activeDocument.dirty && <span className="dirty-dot" aria-label="未保存">●</span>}
          {mode === 'reading' && <span className="readonly-badge">只读</span>}
        </div>
        <div className="view-actions">
          {mode !== 'source' && (
            <label className="line-spacing-control" title="调整排版行间距">
              <span className="visually-hidden">行间距</span>
              <select aria-label="行间距" value={preferences.lineSpacing} onChange={(event) => {
                void updatePreferences({ lineSpacing: event.currentTarget.value as LineSpacing })
              }}>
                {LINE_SPACINGS.map(({ value, label }) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
          )}
          <div className="mode-switcher" role="group" aria-label="编辑器视图">
            {modes.map(({ mode: option, label, title, icon: Icon }) => (
              <button key={option} type="button" className={mode === option ? 'active' : ''}
                aria-pressed={mode === option} aria-label={`${label}模式`} onClick={() => switchMode(option)} title={title}>
                <Icon /><span className="visually-hidden">{label}</span>
              </button>
            ))}
          </div>
          <button className="theme-toggle" type="button"
            onClick={() => {
              const next: Theme = dark ? 'light' : 'dark'
              applyTheme(next)
              void window.inkdown.view.setTheme(next)
            }} aria-label="切换明暗主题" title={`当前主题：${theme === 'system' ? '跟随系统' : theme === 'dark' ? '深色' : '浅色'}`}>
            {dark ? <Sun /> : <Moon />}
          </button>
          <button type="button" onClick={() => setSettingsSection('appearance')} title="设置 (Ctrl+,)" aria-label="设置">
            <Settings />
          </button>
          <button type="button" onClick={() => setFeedbackOpen(true)} title="意见反馈" aria-label="意见反馈">
            <MessageSquarePlus />
          </button>
        </div>
      </header>

      {mode === 'source' && (
        <div className="formatbar" role="toolbar" aria-label="Markdown 格式">
          <label className="heading-control">
            <span className="visually-hidden">段落样式</span>
            <select aria-label="段落样式" defaultValue="" onChange={(event) => {
              if (event.currentTarget.value !== '') applyHeading(Number(event.currentTarget.value))
              event.currentTarget.value = ''
            }}>
              <option value="" disabled>标题</option>
              <option value="0">正文</option>
              <option value="1">一级标题</option>
              <option value="2">二级标题</option>
              <option value="3">三级标题</option>
              <option value="4">四级标题</option>
              <option value="5">五级标题</option>
              <option value="6">六级标题</option>
            </select>
          </label>
          <button type="button" onClick={() => applyFormat('**', '**', '粗体')} title="粗体 (Ctrl+B)" aria-label="插入粗体"><Bold /></button>
          <button type="button" onClick={() => applyFormat('*', '*', '斜体')} title="斜体 (Ctrl+I)" aria-label="插入斜体"><Italic /></button>
          <button type="button" onClick={() => applyFormat('~~', '~~', '删除线')} title="删除线" aria-label="插入删除线"><Strikethrough /></button>
          <span className="separator" />
          <button type="button" onClick={() => applyLinePrefix('bullet', '列表项')} title="无序列表" aria-label="插入无序列表"><List /></button>
          <button type="button" onClick={() => applyLinePrefix('ordered', '列表项')} title="有序列表" aria-label="插入有序列表"><ListOrdered /></button>
          <button type="button" onClick={() => applyLinePrefix('task', '任务')} title="任务列表" aria-label="插入任务列表"><CheckSquare /></button>
          <button type="button" onClick={() => applyLinePrefix('quote', '引用')} title="引用" aria-label="插入引用"><Quote /></button>
          <span className="separator" />
          <button type="button" onClick={() => applyFormat('`', '`', '代码')} title="行内代码" aria-label="插入行内代码"><Braces /></button>
          <button className="badged-tool" type="button"
            onClick={() => applyBlockFormat(`\`\`\`${preferences.codeLanguage}\n`, '\n```', '代码')}
            title="代码块" aria-label="插入代码块"><Code2 /><small>块</small></button>
          <button type="button" onClick={() => applyBlockFormat('```mermaid\n', '\n```', MERMAID_SAMPLE)}
            title="Mermaid 图表" aria-label="插入 Mermaid 图表"><Workflow /></button>
          <button type="button" onClick={() => applyFormat('$', '$', 'E = mc^2')} title="行内公式" aria-label="插入行内公式"><Sigma /></button>
          <button className="badged-tool" type="button" onClick={() => {
            const label = createEquationLabel(activeDocument.content)
            applyBlockFormat(`$$\n% @eq ${label}\n`, '\n$$', '\\sum_{i=1}^{n} i')
          }} title="编号公式" aria-label="插入编号公式"><Sigma /><small>编号</small></button>
          <label className="equation-reference-control">
            <span className="visually-hidden">引用公式</span>
            <select aria-label="引用公式" defaultValue="" disabled={equations.length === 0}
              onChange={(event) => {
                const label = event.currentTarget.value
                if (label) insertLiteral(`[式 @${label}](#eq-${label})`)
                event.currentTarget.value = ''
              }}>
              <option value="" disabled>{equations.length ? '引用公式' : '暂无公式'}</option>
              {equations.map((equation) => (
                <option key={equation.label} value={equation.label}>
                  {`式 (${equation.number}) · ${equation.label}`}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => applyBlockFormat('', '', '---')} title="分隔线" aria-label="插入分隔线"><Minus /></button>
          <button type="button" onClick={() => applyBlockFormat('', '', '| 列 1 | 列 2 |\n| --- | --- |\n| 内容 | 内容 |')}
            title="表格" aria-label="插入表格"><Table2 /></button>
          <span className="separator" />
          <button type="button" onClick={() => applyFormat('[', '](https://)', '链接')} title="链接" aria-label="插入链接"><Link /></button>
          <button type="button" onClick={() => insertImageRef.current()} title="插入图片 (Ctrl+Shift+I)" aria-label="插入图片">
            <Image />
          </button>
        </div>
      )}

      <main className={`workspace ${sidebarOpen ? 'has-sidebar' : ''}`}
        style={{ '--sidebar-width': `${sidebarWidth}px` } as CSSProperties}>
        {sidebarOpen && (
          <Sidebar view={sidebarView} onViewChange={setSidebarView} width={sidebarWidth} onWidthChange={changeSidebarWidth}
            outline={outline} onOutlineSelect={selectOutline} workspace={workspace} activePath={activeDocument.filePath}
            onOpenFolder={openFolderAction} onRefreshFolder={refreshFolderAction}
            onCloseFolder={closeFolderAction} onOpenFile={openFileAction} />
        )}
        {mode === 'source' ? (
          <section className="editor-pane" aria-label="Markdown 编辑器">
            <div className="editor-shell">
              <div className="line-numbers" ref={lineNumbersRef} aria-hidden="true">
                <span className="line-number-list">{lineNumbers}</span>
                <span className="current-line-number" style={{
                  '--line-index': Math.min(currentLine, stats.lines) - 1,
                } as CSSProperties}>{Math.min(currentLine, stats.lines)}</span>
              </div>
              <textarea ref={editorRef} value={activeDocument.content}
                onChange={(event) => {
                  typedContent.current = event.target.value
                  updateContent(event.target.value)
                }}
                onKeyDown={handleEditorKeyDown} onClick={updateCurrentLine} onKeyUp={updateCurrentLine}
                onSelect={updateCurrentLine} onScroll={(event) => {
                  sourceSelection.current.scrollTop = event.currentTarget.scrollTop
                  if (lineNumbersRef.current) lineNumbersRef.current.scrollTop = event.currentTarget.scrollTop
                }}
                onPaste={(event) => {
                  if (!shouldPasteImages(event.clipboardData)) return
                  event.preventDefault()
                  void insertSourceImages(imageFiles(event.clipboardData))
                }}
                onDragOver={(event) => { if (draggingImages(event.dataTransfer)) event.preventDefault() }}
                onDrop={(event) => {
                  const files = imageFiles(event.dataTransfer)
                  if (!files.length) return
                  event.preventDefault()
                  event.stopPropagation()
                  void insertSourceImages(files)
                }}
                wrap="off" spellCheck={preferences.spellcheck} aria-label="Markdown 源码" placeholder="开始写作…" />
            </div>
          </section>
        ) : (
          <section className="visual-pane" aria-label={mode === 'reading' ? 'Markdown 阅读视图' : 'Markdown 所见即所得区域'}>
            <Suspense fallback={<div className="visual-editor-loading" aria-label="正在准备所见即所得编辑器" />}>
              <WysiwygEditor markdown={activeDocument.content} documentId={activeDocument.documentId}
                documentPath={activeDocument.filePath} readOnly={mode === 'reading'} codeLanguage={preferences.codeLanguage}
                onChange={updateContent} onNotice={showNotice} onReady={editorReady} />
            </Suspense>
          </section>
        )}
      </main>

      {dragging && <div className="drop-overlay">释放以打开文档</div>}
      {feedbackOpen && <FeedbackDialog onClose={() => setFeedbackOpen(false)} />}
      {settingsSection && (
        <SettingsDialog documentPath={activeDocument.filePath} preferences={preferences} initialSection={settingsSection}
          onClose={() => setSettingsSection(null)} onSave={updatePreferences} onSaved={showNotice} />
      )}
      <footer className="statusbar">
        <div className="status-messages">
          <span className="status-text" aria-live="polite" title={statusMessage}>{statusMessage}</span>
          {saveProblem && <span className="status-problem" role="alert" title={saveProblem}>{saveProblem}</span>}
          {updateMessage && (
            <span className="update-status" aria-live={updateState.phase === 'downloading' ? 'off' : 'polite'}>
              {updateMessage}
            </span>
          )}
        </div>
        <span className="document-name" title={activeDocument.filePath ?? undefined}>
          <bdi>{activeDocument.filePath ?? '尚未保存到磁盘'}</bdi>
        </span>
        <div className="stats"><span>{stats.words} 字词</span><span>{stats.characters} 字符</span>
          <span>{mode === 'source' ? `行 ${Math.min(currentLine, stats.lines)}/${stats.lines}` : `${stats.lines} 行`}</span>
          <span>约 {stats.readingMinutes} 分钟阅读</span></div>
      </footer>
    </div>
  )
}

export default App
