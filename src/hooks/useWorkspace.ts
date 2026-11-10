import { useCallback, useEffect, useRef, useState } from 'react'
import type { WorkspaceSnapshot } from '../contracts'

export function useWorkspace(onOpened: () => void) {
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null)
  const rootRef = useRef<string | null>(null)
  const onOpenedRef = useRef(onOpened)

  useEffect(() => {
    onOpenedRef.current = onOpened
  })

  const apply = useCallback((snapshot: WorkspaceSnapshot | null) => {
    const opened = snapshot !== null && snapshot.root !== rootRef.current
    rootRef.current = snapshot?.root ?? null
    setWorkspace(snapshot)
    if (opened) onOpenedRef.current()
  }, [])

  useEffect(() => {
    let active = true
    let updated = false
    const unsubscribe = window.inkdown.workspace.onUpdated((snapshot) => {
      updated = true
      if (active) apply(snapshot)
    })
    void window.inkdown.workspace.get().then((snapshot) => {
      if (active && !updated) apply(snapshot)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [apply])

  const openFolder = useCallback(async () => apply(await window.inkdown.workspace.open()), [apply])
  const refreshFolder = useCallback(async () => apply(await window.inkdown.workspace.refresh()), [apply])
  const closeFolder = useCallback(async () => apply(await window.inkdown.workspace.close()), [apply])

  return { workspace, openFolder, refreshFolder, closeFolder }
}
