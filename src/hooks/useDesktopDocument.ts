import { useCallback, useEffect, useRef, useState } from 'react'
import type { DocumentSnapshot } from '../contracts'

const initial: DocumentSnapshot = {
  content: '',
  filePath: null,
  fileName: '未命名.md',
  dirty: false,
}

export function useDesktopDocument() {
  const [document, setDocument] = useState(initial)
  const [status, setStatus] = useState('正在启动…')
  const applyingMainUpdate = useRef(false)
  const latestContent = useRef(initial.content)
  const pendingContent = useRef<string | null>(null)
  const syncQueue = useRef<Promise<void>>(Promise.resolve())
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flushChanges = useCallback(() => {
    if (syncTimer.current) clearTimeout(syncTimer.current)
    syncTimer.current = null
    const content = pendingContent.current
    pendingContent.current = null
    if (content === null) return syncQueue.current
    const request = syncQueue.current.then(() => window.inkdown.document.changed(content))
    syncQueue.current = request.catch(() => undefined)
    return request
  }, [])

  useEffect(() => {
    const apply = (snapshot: DocumentSnapshot) => {
      applyingMainUpdate.current = true
      setDocument((current) => {
        if (current.dirty && snapshot.dirty && snapshot.content !== latestContent.current) {
          return { ...snapshot, content: current.content, dirty: true }
        }
        latestContent.current = snapshot.content
        return snapshot
      })
      setStatus(snapshot.recovered
        ? '已恢复崩溃草稿（尚未写入磁盘）'
        : snapshot.dirty
          ? '有未保存的更改'
          : snapshot.filePath ? `已打开 ${snapshot.fileName}` : '就绪')
      queueMicrotask(() => { applyingMainUpdate.current = false })
    }
    const unsubscribeUpdate = window.inkdown.document.onUpdated(apply)
    void window.inkdown.document.initialize().then(apply)
    return () => {
      void flushChanges()
      unsubscribeUpdate()
    }
  }, [flushChanges])

  const updateContent = useCallback((content: string) => {
    latestContent.current = content
    pendingContent.current = content
    setDocument((current) => ({ ...current, content, dirty: true }))
    setStatus('有未保存的更改')
    if (applyingMainUpdate.current) return
    if (syncTimer.current) clearTimeout(syncTimer.current)
    syncTimer.current = setTimeout(() => void flushChanges(), 60)
  }, [flushChanges])

  const run = useCallback(async (operation: () => Promise<{ ok: boolean; canceled?: boolean; error?: string }>, success: string) => {
    try {
      await flushChanges()
    } catch {
      setStatus('无法同步最新编辑内容')
      return { ok: false, error: '无法同步最新编辑内容' }
    }
    const result = await operation()
    if (result.ok) setStatus(success)
    else if (result.error) setStatus(result.error)
    return result
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
  const saveDocument = useCallback(
    () => run(window.inkdown.document.save, '已保存'), [run],
  )
  const saveAsDocument = useCallback(
    () => run(window.inkdown.document.saveAs, '已另存为'), [run],
  )
  const closeDocument = useCallback(
    () => run(window.inkdown.document.close, '已关闭'), [run],
  )

  return {
    document,
    status,
    updateContent,
    newDocument,
    openDocument,
    openPath,
    saveDocument,
    saveAsDocument,
    closeDocument,
  }
}
