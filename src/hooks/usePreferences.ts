import { useCallback, useEffect, useRef, useState } from 'react'
import type { Preferences, PreferencesResult } from '../contracts'
import { DEFAULT_PREFERENCES, readPreferences } from '../preferences'

const LEGACY_LINE_SPACING = 'inkdown-line-spacing'

export function usePreferences() {
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFERENCES)
  const [loaded, setLoaded] = useState(false)
  const latest = useRef(preferences)
  latest.current = preferences

  const update = useCallback(async (patch: Partial<Preferences>): Promise<PreferencesResult> => {
    const previous = latest.current
    setPreferences(readPreferences({ ...previous, ...patch }))
    const result = await window.inkdown.settings.set(patch)
      .catch((): PreferencesResult => ({ ok: false, error: '无法保存设置' }))
    setPreferences(result.ok ? result.value : previous)
    return result
  }, [])

  useEffect(() => {
    let active = true
    const unsubscribe = window.inkdown.settings.onChanged((value) => { if (active) setPreferences(value) })
    void window.inkdown.settings.get().then((value) => {
      if (!active) return
      setPreferences(readPreferences(value))
      setLoaded(true)
      // Line spacing used to live in localStorage; it moves into the settings file once.
      const legacy = localStorage.getItem(LEGACY_LINE_SPACING)
      if (legacy === null) return
      localStorage.removeItem(LEGACY_LINE_SPACING)
      if (legacy !== value.lineSpacing) void update({ lineSpacing: legacy as Preferences['lineSpacing'] })
    }, () => { if (active) setLoaded(true) })
    return () => {
      active = false
      unsubscribe()
    }
  }, [update])

  return { preferences, loaded, update }
}
