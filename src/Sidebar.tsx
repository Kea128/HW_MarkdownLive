import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { ChevronDown, ChevronRight, FileText, FolderOpen, RefreshCw, X } from 'lucide-react'
import type { WorkspaceEntry, WorkspaceSnapshot } from './contracts'
import { clampSidebarWidth, SIDEBAR_WIDTH } from './sidebar-width'

export interface OutlineItem {
  level: number
  text: string
  line: number
  offset: number
}

export type SidebarView = 'files' | 'outline'

interface SidebarProps {
  view: SidebarView
  onViewChange(view: SidebarView): void
  width: number
  onWidthChange(width: number): void
  outline: OutlineItem[]
  onOutlineSelect(item: OutlineItem, index: number): void
  workspace: WorkspaceSnapshot | null
  activePath: string | null
  onOpenFolder(): void
  onRefreshFolder(): void
  onCloseFolder(): void
  onOpenFile(filePath: string): void
}

const views: Array<{ view: SidebarView; label: string }> = [
  { view: 'files', label: '文件' },
  { view: 'outline', label: '大纲' },
]
const samePath = (left: string | null, right: string) => left?.toLowerCase() === right.toLowerCase()
const isAncestor = (folder: string, filePath: string | null) =>
  filePath !== null && /[\\/]/.test(filePath.charAt(folder.length))
  && filePath.toLowerCase().startsWith(folder.toLowerCase())

function folderPaths(entries: WorkspaceEntry[]): string[] {
  return entries.flatMap((entry) => entry.children ? [entry.path, ...folderPaths(entry.children)] : [])
}

function FileTree({ workspace, activePath, onOpenFile }: {
  workspace: WorkspaceSnapshot
  activePath: string | null
  onOpenFile(filePath: string): void
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(
    () => new Set(workspace.fileCount > 300 ? folderPaths(workspace.entries) : []),
  )
  const [revealed, setRevealed] = useState(activePath)
  if (revealed !== activePath) {
    setRevealed(activePath)
    if ([...collapsed].some((folder) => isAncestor(folder, activePath))) {
      setCollapsed(new Set([...collapsed].filter((folder) => !isAncestor(folder, activePath))))
    }
  }
  const toggle = (folder: string) => {
    const next = new Set(collapsed)
    if (!next.delete(folder)) next.add(folder)
    setCollapsed(next)
  }

  const render = (entries: WorkspaceEntry[], depth: number) => (
    <ul className="file-tree">
      {entries.map((entry) => {
        const indent = { paddingLeft: `${8 + depth * 14}px` }
        if (entry.children) {
          const open = !collapsed.has(entry.path)
          return (
            <li key={entry.path}>
              <button type="button" className="tree-folder" style={indent} title={entry.path}
                aria-expanded={open} onClick={() => toggle(entry.path)}>
                {open ? <ChevronDown /> : <ChevronRight />}<span>{entry.name}</span>
              </button>
              {open && render(entry.children, depth + 1)}
            </li>
          )
        }
        const active = samePath(activePath, entry.path)
        return (
          <li key={entry.path}>
            <button type="button" className={`tree-file ${active ? 'active' : ''}`} style={indent} title={entry.path}
              aria-current={active ? 'page' : undefined} onClick={() => onOpenFile(entry.path)}>
              <FileText /><span>{entry.name}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )

  return <nav className="file-tree-root" aria-label="文件夹中的 Markdown 文件">{render(workspace.entries, 0)}</nav>
}

function FilesPanel({ workspace, activePath, onOpenFolder, onRefreshFolder, onCloseFolder, onOpenFile }: Pick<
  SidebarProps, 'workspace' | 'activePath' | 'onOpenFolder' | 'onRefreshFolder' | 'onCloseFolder' | 'onOpenFile'
>) {
  if (!workspace) {
    return (
      <div className="sidebar-empty">
        <p>打开文件夹后，这里会列出其中所有 Markdown 文件，点击即可打开。</p>
        <button type="button" className="sidebar-primary" onClick={onOpenFolder}>
          <FolderOpen />打开文件夹
        </button>
      </div>
    )
  }
  return (
    <>
      <div className="folder-header">
        <span className="folder-name" title={workspace.root}>{workspace.name}</span>
        <button type="button" onClick={onOpenFolder} title="打开其他文件夹 (Ctrl+Shift+O)" aria-label="打开其他文件夹">
          <FolderOpen />
        </button>
        <button type="button" onClick={onRefreshFolder} title="刷新文件列表" aria-label="刷新文件列表"><RefreshCw /></button>
        <button type="button" onClick={onCloseFolder} title="关闭文件夹" aria-label="关闭文件夹"><X /></button>
      </div>
      {workspace.fileCount
        ? <FileTree key={workspace.root} workspace={workspace} activePath={activePath} onOpenFile={onOpenFile} />
        : <p className="sidebar-note">该文件夹中没有 Markdown 文件。</p>}
      {workspace.truncated && <p className="sidebar-note">文件过多或目录层级过深，部分文件未列出。</p>}
    </>
  )
}

function OutlinePanel({ outline, onOutlineSelect }: Pick<SidebarProps, 'outline' | 'onOutlineSelect'>) {
  return (
    <nav className="outline" aria-label="文档大纲">
      {outline.length ? outline.map((item, index) => (
        <button key={`${item.line}-${item.text}`} type="button" style={{ paddingLeft: `${12 + (item.level - 1) * 12}px` }}
          onClick={() => onOutlineSelect(item, index)}>
          <span>{item.text}</span><small>{item.line}</small>
        </button>
      )) : <p className="outline-empty">添加标题后，这里会显示文档结构。</p>}
    </nav>
  )
}

function SidebarResizer({ width, onWidthChange }: Pick<SidebarProps, 'width' | 'onWidthChange'>) {
  const drag = useRef<{ pointerId: number; startX: number; startWidth: number; width: number } | null>(null)

  const finish = (event: PointerEvent<HTMLDivElement>) => {
    const state = drag.current
    if (!state || state.pointerId !== event.pointerId) return
    drag.current = null
    document.body.classList.remove('is-resizing-sidebar')
    onWidthChange(state.width)
  }

  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 48 : 16
    const current = clampSidebarWidth(width)
    const next = {
      ArrowLeft: current - step,
      ArrowRight: current + step,
      Home: SIDEBAR_WIDTH.min,
      End: Number.POSITIVE_INFINITY,
    }[event.key]
    if (next === undefined) return
    event.preventDefault()
    onWidthChange(clampSidebarWidth(next))
  }

  return (
    <div className="sidebar-resizer" role="separator" aria-orientation="vertical" aria-label="调整侧栏宽度"
      aria-valuemin={SIDEBAR_WIDTH.min} aria-valuemax={clampSidebarWidth(Number.POSITIVE_INFINITY)}
      aria-valuenow={clampSidebarWidth(width)} tabIndex={0} title="拖动调整侧栏宽度，双击恢复默认宽度"
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        const startWidth = clampSidebarWidth(width)
        drag.current = { pointerId: event.pointerId, startX: event.clientX, startWidth, width: startWidth }
        document.body.classList.add('is-resizing-sidebar')
      }}
      onPointerMove={(event) => {
        const state = drag.current
        if (!state || state.pointerId !== event.pointerId) return
        state.width = clampSidebarWidth(state.startWidth + event.clientX - state.startX)
        event.currentTarget.parentElement?.style.setProperty('--sidebar-width', `${state.width}px`)
        event.currentTarget.setAttribute('aria-valuenow', String(state.width))
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
      onDoubleClick={() => onWidthChange(SIDEBAR_WIDTH.default)}
      onKeyDown={keyDown}
    />
  )
}

export function Sidebar(props: SidebarProps) {
  const { view, onViewChange } = props
  return (
    <>
      <aside className="sidebar" aria-label="侧栏">
        <div className="sidebar-tabs" role="tablist" aria-label="侧栏内容" onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
          event.preventDefault()
          const next = view === 'files' ? 'outline' : 'files'
          onViewChange(next)
          event.currentTarget.querySelector<HTMLButtonElement>(`#sidebar-tab-${next}`)?.focus()
        }}>
          {views.map((option) => (
            <button key={option.view} id={`sidebar-tab-${option.view}`} type="button" role="tab"
              aria-selected={view === option.view} aria-controls="sidebar-panel" tabIndex={view === option.view ? 0 : -1}
              onClick={() => onViewChange(option.view)}>
              {option.label}
            </button>
          ))}
        </div>
        <div className="sidebar-panel" id="sidebar-panel" role="tabpanel" aria-labelledby={`sidebar-tab-${view}`}>
          {view === 'files' ? <FilesPanel {...props} /> : <OutlinePanel {...props} />}
        </div>
      </aside>
      <SidebarResizer width={props.width} onWidthChange={props.onWidthChange} />
    </>
  )
}
