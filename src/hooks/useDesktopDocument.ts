import { useCallback, useEffect, useRef, useState } from 'react'
import type { DocumentSnapshot, OperationResult } from '../contracts'

const initial: DocumentSnapshot = {
  documentId: 0,
  content: '',
  filePath: null,
  fileName: '未命名.md',
  dirty: false,
}

interface Options {
  /** Reports edits the visual editor is still holding back, before a document operation reads the text. */
  flushEditor?: () => void
  onNotice?: (message: string) => void
}

export function useDesktopDocument({ flushEditor, onNotice }: Options = {}) {
  const [document, setDocument] = useState(initial)
  const [status, setStatus] = useState('正在启动…')
  /** Stays visible until a save succeeds, unlike status messages that the next keystroke replaces. */
  const [saveProblem, setSaveProblem] = useState<string | null>(null)
  const documentId = useRef(initial.documentId)
  const latestContent = useRef(initial.content)
  const dirty = useRef(false)
  const pendingContent = useRef<string | null>(null)
  const inFlight = useRef(0)
  const busy = useRef(0)
  const syncQueue = useRef<Promise<void>>(Promise.resolve())
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const options = useRef({ flushEditor, onNotice })
  options.current = { flushEditor, onNotice }

  const flushChanges = useCallback(() => {
    if (syncTimer.current) clearTimeout(syncTimer.current)
    syncTimer.current = null
    const content = pendingContent.current
    pendingContent.current = null
    if (content === null) return syncQueue.current
    const target = documentId.current
    inFlight.current += 1
    const request = syncQueue.current
      .then(() => window.inkdown.document.changed(content, target))
      .finally(() => { inFlight.current -= 1 })
    syncQueue.current = request.catch(() => undefined)
    return request
  }, [])

  useEffect(() => {
    const apply = (snapshot: DocumentSnapshot) => {
      const replaced = snapshot.documentId !== documentId.current
      // A save finishing while newer keystrokes are still on their way must not roll the editor back.
      const keepLocal = !replaced && snapshot.content !== latestContent.current
        && (pendingContent.current !== null || inFlight.current > 0)
      if (replaced) {
        documentId.current = snapshot.documentId
        if (syncTimer.current) clearTimeout(syncTimer.current)
        syncTimer.current = null
        pendingContent.current = null
        setSaveProblem(null)
      }
      if (keepLocal) {
        dirty.current = true
        setDocument((current) => ({ ...snapshot, content: current.content, dirty: true }))
      } else {
        latestContent.current = snapshot.content
        dirty.current = snapshot.dirty
        setDocument(snapshot)
      }
      if (!snapshot.dirty) setSaveProblem(null)
      setStatus(snapshot.recovered
        ? '已恢复崩溃草稿（尚未写入磁盘）'
        : snapshot.dirty || keepLocal
          ? '有未保存的更改'
          : snapshot.filePath ? `已打开 ${snapshot.fileName}` : '就绪')
      if (snapshot.notice) options.current.onNotice?.(snapshot.notice)
    }
    const unsubscribeUpdate = window.inkdown.document.onUpdated(apply)
    void window.inkdown.document.initialize().then(apply)
    return () => {
      void flushChanges()
      unsubscribeUpdate()
    }
  }, [flushChanges])

  const updateContent = useCallback((content: string) => {
    if (content === latestContent.current) return
    latestContent.current = content
    pendingContent.current = content
    dirty.current = true
    setDocument((current) => ({ ...current, content, dirty: true }))
    setStatus('有未保存的更改')
    if (syncTimer.current) clearTimeout(syncTimer.current)
    syncTimer.current = setTimeout(() => void flushChanges(), 60)
  }, [flushChanges])

  const run = useCallback(async (operation: () => Promise<OperationResult>, success: string): Promise<OperationResult> => {
    busy.current += 1
    try {
      options.current.flushEditor?.()
      try {
        await flushChanges()
      } catch {
        setStatus('无法同步最新编辑内容')
        return { ok: false, error: '无法同步最新编辑内容' }
      }
      const result = await operation()
      if (result.ok) setStatus(dirty.current ? '有未保存的更改' : success)
      else if (result.error) setStatus(result.error)
      return result
    } finally {
      busy.current -= 1
    }
  }, [flushChanges])

  const newDocument = useCallback(
    () => run(window.inkdown.document.newDocument, '已新建文稿'), [run],
  )
  const openDocument = useCallback(
    () => run(window.inkdown.document.open, '已打开文稿'), [run],
  )
  const openPath = useCallback(
    (filePath: string) => run(() => window.inkdown.document.openPath(filePath), '已打开文稿'),
    [run],
  )
  const saveDocument = useCallback(async () => {
    const result = await run(() => window.inkdown.document.save(), '已保存')
    if (result.ok) setSaveProblem(null)
    return result
  }, [run])
  /** Skips while another operation runs; a conflict or failure stays in the status bar until a save succeeds. */
  const autoSaveDocument = useCallback(async () => {
    if (busy.current > 0) return { ok: false, canceled: true }
    const result = await run(() => window.inkdown.document.save({ auto: true }), '已自动保存')
    if (result.ok) setSaveProblem(null)
    else if (result.error) setSaveProblem(result.conflict ? result.error : `自动保存失败：${result.error}`)
    return result
  }, [run])
  const saveAsDocument = useCallback(async () => {
    const result = await run(window.inkdown.document.saveAs, '已另存为')
    if (result.ok) setSaveProblem(null)
    return result
  }, [run])
  const closeDocument = useCallback(
    () => run(window.inkdown.document.close, '已关闭'), [run],
  )
  const isBusy = useCallback(() => busy.current > 0, [])

  return {
    document,
    status,
    saveProblem,
    updateContent,
    newDocument,
    openDocument,
    openPath,
    saveDocument,
    autoSaveDocument,
    saveAsDocument,
    closeDocument,
    isBusy,
  }
}
