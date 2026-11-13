import {
  lazy, Suspense, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState,
  type CSSProperties, type DragEvent, type KeyboardEvent,
} from 'react'
import {
  Bold, Braces, CheckSquare, Code2, Eye, FilePlus2, FolderOpen, FolderTree,
  Image, Italic, Link, List, ListOrdered, MessageSquarePlus, Minus, Moon, PanelLeftClose, PanelLeftOpen,
  Quote, Save, SaveAll, Settings, Sigma, Strikethrough, Sun, Table2, Text, Workflow,
} from 'lucide-react'
import { createEquationLabel, getEquationDefinitions } from './equations'
import { FeedbackDialog } from './FeedbackDialog'
import { useDesktopDocument } from './hooks/useDesktopDocument'
import { useSourceEditorActions } from './hooks/useSourceEditorActions'
import { useWorkspace } from './hooks/useWorkspace'
import {
  chooseImages, draggingImages, imageFiles, imageMarkdown, shouldPasteImages, storeImages, type StoredImage,
} from './paste-images'
import { SettingsDialog } from './SettingsDialog'
import { Sidebar, type OutlineItem, type SidebarView } from './Sidebar'
import { readSidebarWidth, SIDEBAR_WIDTH } from './sidebar-width'
import { getDocumentStats, type EditorMode } from './utils'
import type { Theme, UpdateState } from './contracts'
import type { EditorApi } from './WysiwygEditor'
import './App.css'

const WysiwygEditor = lazy(() => import('./WysiwygEditor'))
const SOURCE_LINE_HEIGHT = 28
const DOCUMENT_FILE = /\.(?:md|markdown|txt)$/i
const MERMAID_SAMPLE = 'flowchart LR\n  A[开始] --> B{是否完成？}\n  B -- 是 --> C[发布]\n  B -- 否 --> D[继续修改]'

const modes: Array<{ mode: EditorMode; label: string; icon: typeof Eye }> = [
  { mode: 'visual', label: '所见即所得', icon: Eye },
  { mode: 'source', label: '源码', icon: Text },
]

type LineSpacing = 'compact' | 'standard' | 'relaxed'

const lineSpacingOptions: Array<{ value: LineSpacing; label: string }> = [
  { value: 'compact', label: '紧凑' },
  { value: 'standard', label: '标准' },
  { value: 'relaxed', label: '宽松' },
]

function describeUpdate(state: UpdateState): string | null {
  if (state.phase === 'checking') return '正在检查更新…'
  if (state.phase === 'downloading') return `正在下载 v${state.version}（${Math.floor(state.percent)}%）`
  if (state.phase === 'downloaded') return `v${state.version} 已下载，退出时自动安装`
  return null
}

function App() {
  const {
    document: activeDocument, status, updateContent, newDocument, openDocument,
    openPath, saveDocument, saveAsDocument, closeDocument,
  } = useDesktopDocument()
  const [mode, setMode] = useState<EditorMode>('visual')
  const [theme, setTheme] = useState<Theme>('system')
  const [updateState, setUpdateState] = useState<UpdateState>({ phase: 'idle' })
  const updateMessage = describeUpdate(updateState)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarView, setSidebarView] = useState<SidebarView>('outline')
  const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const editorApi = useRef<EditorApi | null>(null)
  const modeRef = useRef(mode)
  modeRef.current = mode
  const [notice, setNotice] = useState<string | null>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const showNotice = useCallback((message: string) => {
    clearTimeout(noticeTimer.current)
    setNotice(message)
    noticeTimer.current = setTimeout(() => setNotice(null), 5_000)
  }, [])
  const { workspace, openFolder, refreshFolder, closeFolder } = useWorkspace(() => {
    setSidebarOpen(true)
    setSidebarView('files')
  })
  const [currentLine, setCurrentLine] = useState(1)
  const [lineSpacing, setLineSpacing] = useState<LineSpacing>(() => {
    const saved = localStorage.getItem('inkdown-line-spacing')
    return lineSpacingOptions.some(({ value }) => value === saved)
      ? saved as LineSpacing
      : 'standard'
  })
  const themeRef = useRef<Theme>('system')
  const [dragging, setDragging] = useState(false)
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const lineNumbersRef = useRef<HTMLDivElement>(null)
  // Derived panels follow the text a frame later so typing in long documents is not blocked by them.
  const deferredContent = useDeferredValue(activeDocument.content)
  const stats = useMemo(() => getDocumentStats(deferredContent), [deferredContent])
  const lines = useMemo(() => deferredContent.split('\n'), [deferredContent])
  const lineNumbers = useMemo(() => lines.map((_, index) => index + 1).join('\n'), [lines])
  const equations = useMemo(() => getEquationDefinitions(deferredContent), [deferredContent])
  const outline = useMemo(() => {
    let offset = 0
    return lines.flatMap((line, index): OutlineItem[] => {
      const match = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line)
      const item = match ? [{ level: match[1].length, text: match[2], line: index + 1, offset }] : []
      offset += line.length + 1
      return item
    })
  }, [lines])
  const {
    applyFormat, applyHeading, applyBlockFormat, insertLiteral,
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
    if (modeRef.current === 'source') void chooseImages(showNotice).then(insertSourceMarkdown)
    else editorApi.current?.insertImages()
  }

  useEffect(() => {
    const applyTheme = (value: Theme) => {
      themeRef.current = value
      setTheme(value)
      const dark = value === 'dark' || (value === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
      document.documentElement.dataset.theme = dark ? 'dark' : 'light'
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
    }
    applyTheme('system')
    const unMode = window.inkdown.view.onMode((nextMode) => {
      setMode((current) => nextMode === 'toggle'
        ? (current === 'visual' ? 'source' : 'visual')
        : nextMode)
    })
    const unTheme = window.inkdown.view.onTheme(applyTheme)
    const media = matchMedia('(prefers-color-scheme: dark)')
    const systemChanged = () => { if (themeRef.current === 'system') applyTheme('system') }
    media.addEventListener('change', systemChanged)
    return () => {
      unMode()
      unTheme()
      media.removeEventListener('change', systemChanged)
    }
  }, [])

  useEffect(() => {
    const toggleSource = (event: globalThis.KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || (event.code !== 'Slash' && event.key !== '/')) return
      event.preventDefault()
      setMode((current) => current === 'visual' ? 'source' : 'visual')
    }
    window.addEventListener('keydown', toggleSource)
    return () => window.removeEventListener('keydown', toggleSource)
  }, [])

  useEffect(() => window.inkdown.updates.onState(setUpdateState), [])
  useEffect(() => window.inkdown.feedback.onShow(() => setFeedbackOpen(true)), [])
  useEffect(() => window.inkdown.settings.onShow(() => setSettingsOpen(true)), [])

  const changeSidebarWidth = (width: number) => {
    setSidebarWidth(width)
    localStorage.setItem(SIDEBAR_WIDTH.storageKey, String(width))
  }

  const selectOutline = (item: OutlineItem, index: number) => {
    const editor = editorRef.current
    if (editor) {
      editor.focus()
      editor.setSelectionRange(item.offset, item.offset)
      editor.scrollTop = Math.max(0, (item.line - 3) * SOURCE_LINE_HEIGHT)
      setCurrentLine(item.line)
      return
    }
    const headings = document.querySelectorAll<HTMLElement>('.visual-editor .ProseMirror :is(h1, h2, h3, h4, h5, h6)')
    headings[index]?.scrollIntoView({ block: 'start' })
  }

  const handleEditorKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const modifier = event.ctrlKey || event.metaKey
    if (modifier && event.key.toLowerCase() === 'b') {
      event.preventDefault()
      applyFormat('**', '**', '粗体')
    } else if (modifier && event.key.toLowerCase() === 'i') {
      event.preventDefault()
      applyFormat('*', '*', '斜体')
    } else if (event.key === 'Tab') {
      event.preventDefault()
      applyFormat('  ', '', '')
    }
  }

  const updateCurrentLine = () => {
    const editor = editorRef.current
    if (editor) setCurrentLine(editor.value.slice(0, editor.selectionStart).split('\n').length)
  }

  const drop = (event: DragEvent) => {
    setDragging(false)
    const file = event.dataTransfer.files[0]
    if (!file || !DOCUMENT_FILE.test(file.name)) return
    event.preventDefault()
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

  return (
    <div
      className={`app mode-${mode} ${dragging ? 'is-dragging' : ''}`}
      data-line-spacing={lineSpacing}
      onDragOver={(event) => {
        if (!Array.from(event.dataTransfer.items).some((item) => item.kind === 'file' && !item.type.startsWith('image/'))) return
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
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
          <button type="button" onClick={() => void openFolder()} title="打开文件夹 (Ctrl+Shift+O)" aria-label="打开文件夹"><FolderTree /></button>
          <button type="button" onClick={() => void saveDocument()} title="保存 (Ctrl+S)" aria-label="保存文档"><Save /></button>
          <button type="button" onClick={() => void saveAsDocument()} title="另存为 (Ctrl+Shift+S)" aria-label="另存为"><SaveAll /></button>
        </nav>
        <div className="title-area" title={activeDocument.filePath ?? activeDocument.fileName}>
          <span>{activeDocument.fileName}</span>{activeDocument.dirty && <span className="dirty-dot" aria-label="未保存">●</span>}
        </div>
        <div className="view-actions">
          {mode === 'visual' && (
            <label className="line-spacing-control" title="调整排版行间距">
              <span className="visually-hidden">行间距</span>
              <select aria-label="行间距" value={lineSpacing} onChange={(event) => {
                const value = event.currentTarget.value as LineSpacing
                setLineSpacing(value)
                localStorage.setItem('inkdown-line-spacing', value)
              }}>
                {lineSpacingOptions.map(({ value, label }) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
          )}
          <div className="mode-switcher" role="group" aria-label="编辑器视图">
            {modes.map(({ mode: option, label, icon: Icon }) => (
              <button key={option} type="button" className={mode === option ? 'active' : ''}
                aria-pressed={mode === option} aria-label={`${label}模式`} onClick={() => setMode(option)} title={label}>
                <Icon /><span className="visually-hidden">{label}</span>
              </button>
            ))}
          </div>
          <button className="theme-toggle" type="button"
            onClick={() => {
              const next: Theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'
              setTheme(next)
              themeRef.current = next
              document.documentElement.dataset.theme = next
              document.documentElement.style.colorScheme = next
              void window.inkdown.view.setTheme(next)
            }} aria-label="切换明暗主题" title={`当前主题：${theme === 'system' ? '跟随系统' : theme === 'dark' ? '深色' : '浅色'}`}>
            {document.documentElement.dataset.theme === 'dark' ? <Sun /> : <Moon />}
          </button>
          <button type="button" onClick={() => setSettingsOpen(true)} title="设置 (Ctrl+,)" aria-label="设置">
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
          <button type="button" onClick={() => applyFormat('**', '**', '粗体')} title="粗体" aria-label="插入粗体"><Bold /></button>
          <button type="button" onClick={() => applyFormat('*', '*', '斜体')} title="斜体" aria-label="插入斜体"><Italic /></button>
          <button type="button" onClick={() => applyFormat('~~', '~~', '删除线')} title="删除线" aria-label="插入删除线"><Strikethrough /></button>
          <span className="separator" />
          <button type="button" onClick={() => applyFormat('- ', '', '列表项')} title="无序列表" aria-label="插入无序列表"><List /></button>
          <button type="button" onClick={() => applyFormat('1. ', '', '列表项')} title="有序列表" aria-label="插入有序列表"><ListOrdered /></button>
          <button type="button" onClick={() => applyFormat('- [ ] ', '', '任务')} title="任务列表" aria-label="插入任务列表"><CheckSquare /></button>
          <button type="button" onClick={() => applyFormat('> ', '', '引用')} title="引用" aria-label="插入引用"><Quote /></button>
          <span className="separator" />
          <button type="button" onClick={() => applyFormat('`', '`', '代码')} title="行内代码" aria-label="插入行内代码"><Braces /></button>
          <button className="badged-tool" type="button" onClick={() => applyBlockFormat('```text\n', '\n```', '代码')}
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
            onOpenFolder={() => void openFolder()} onRefreshFolder={() => void refreshFolder()}
            onCloseFolder={() => void closeFolder()} onOpenFile={(filePath) => void openPath(filePath)} />
        )}
        {mode === 'source' ? (
          <section className="editor-pane" aria-label="Markdown 编辑器">
            <div className="editor-shell">
              <div className="line-numbers" ref={lineNumbersRef} aria-hidden="true">
                <span className="line-number-list">{lineNumbers}</span>
                <span className="current-line-number" style={{
                  '--line-index': currentLine - 1,
                } as CSSProperties}>{currentLine}</span>
              </div>
              <textarea ref={editorRef} value={activeDocument.content}
                onChange={(event) => updateContent(event.target.value)}
                onKeyDown={handleEditorKeyDown} onClick={updateCurrentLine} onKeyUp={updateCurrentLine}
                onSelect={updateCurrentLine} onScroll={(event) => {
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
                  void insertSourceImages(files)
                }}
                wrap="off" spellCheck aria-label="Markdown 源码" placeholder="开始写作…" />
            </div>
          </section>
        ) : (
          <section className="visual-pane" aria-label="Markdown 所见即所得区域">
            <Suspense fallback={<div className="visual-editor-loading" aria-label="正在准备所见即所得编辑器" />}>
              <WysiwygEditor markdown={activeDocument.content} documentPath={activeDocument.filePath}
                onChange={updateContent} onNotice={showNotice} onReady={(api) => { editorApi.current = api }} />
            </Suspense>
          </section>
        )}
      </main>

      {dragging && <div className="drop-overlay">释放以打开文档</div>}
      {feedbackOpen && <FeedbackDialog onClose={() => setFeedbackOpen(false)} />}
      {settingsOpen && (
        <SettingsDialog documentPath={activeDocument.filePath} onClose={() => setSettingsOpen(false)} onSaved={showNotice} />
      )}
      <footer className="statusbar" aria-live="polite">
        <div className="status-messages">
          <span>{notice ?? status}</span>
          {updateMessage && (
            <span className="update-status" aria-live={updateState.phase === 'downloading' ? 'off' : undefined}>
              {updateMessage}
            </span>
          )}
        </div>
        <span className="document-name">{activeDocument.filePath ?? '尚未保存到磁盘'}</span>
        <div className="stats"><span>{stats.words} 字词</span><span>{stats.characters} 字符</span>
          <span>行 {currentLine}/{stats.lines}</span><span>约 {stats.readingMinutes} 分钟阅读</span></div>
      </footer>
    </div>
  )
}

export default App
