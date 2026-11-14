import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { X } from 'lucide-react'
import type { ImageFolderSetting, Preferences, PreferencesResult, SettingsSection } from './contracts'
import { expandFolderTemplate, folderTemplate, IMAGE_FOLDER_PRESETS, validateFolderTemplate } from './image-folder'
import {
  CODE_LANGUAGES, CONTENT_WIDTHS, DEFAULT_PREFERENCES, EDITOR_MODES, FONT_SIZES, LINE_SPACINGS, THEMES,
} from './preferences'

interface Props {
  documentPath: string | null
  preferences: Preferences
  initialSection?: SettingsSection
  onClose(): void
  onSave(patch: Partial<Preferences>): Promise<PreferencesResult>
  onSaved(message: string): void
}

const CUSTOM_PLACEHOLDER = 'images/${filename}'

const SECTIONS: Array<{ id: SettingsSection; label: string }> = [
  { id: 'appearance', label: '外观' },
  { id: 'editing', label: '编辑' },
  { id: 'startup', label: '启动' },
  { id: 'images', label: '图片' },
]

function describeFolder(setting: ImageFolderSetting, documentPath: string | null): string {
  const name = documentPath?.replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '') ?? '文档名'
  const folder = expandFolderTemplate(folderTemplate(setting), name)
  const absolute = /^(?:[a-z]:[\\/]|\\\\)/i.test(folder)
  const document = documentPath ? `“${name}”的图片` : '图片'
  return absolute ? `${document}将保存到 ${folder}` : `${document}将保存到文档所在文件夹下的 ${folder}`
}

function changes(current: Preferences, next: Preferences): Partial<Preferences> {
  return Object.fromEntries(Object.entries(next)
    .filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(current[key as keyof Preferences])))
}

export function SettingsDialog({ documentPath, preferences, initialSection = 'appearance', onClose, onSave, onSaved }: Props) {
  const [section, setSection] = useState<SettingsSection>(initialSection)
  // Only what is changed here is saved, so a theme or spell check toggled from the menu meanwhile is kept.
  const [opened] = useState(preferences)
  const [draft, setDraft] = useState(preferences)
  const [custom, setCustom] = useState(
    preferences.imageFolder.mode === 'custom' ? preferences.imageFolder.template : CUSTOM_PLACEHOLDER,
  )
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const dialogRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus())
    return () => previous?.focus()
  }, [])

  const set = <K extends keyof Preferences>(key: K, value: Preferences[K]) => {
    setDraft((current) => ({ ...current, [key]: value }))
    setError(null)
  }
  const imageFolder: ImageFolderSetting = draft.imageFolder.mode === 'custom'
    ? { mode: 'custom', template: custom }
    : draft.imageFolder
  const customError = draft.imageFolder.mode === 'custom' ? validateFolderTemplate(custom) : null
  const codeLanguages = CODE_LANGUAGES.some(({ value }) => value === draft.codeLanguage)
    ? CODE_LANGUAGES
    : [...CODE_LANGUAGES, { value: draft.codeLanguage, label: draft.codeLanguage }]

  const save = async () => {
    if (customError) {
      setSection('images')
      return
    }
    const patch = changes(opened, { ...draft, imageFolder: { mode: imageFolder.mode, template: imageFolder.template.trim() } })
    if (Object.keys(patch).length === 0) {
      onClose()
      return
    }
    setSaving(true)
    const result = await onSave(patch)
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onSaved(patch.imageFolder ? '设置已保存，之后粘贴或插入的图片会保存到新位置' : '设置已保存')
    onClose()
  }

  const keyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>('input, select, textarea, button, [tabindex="0"]')]
      .filter((element) => !element.matches(':disabled') && element.offsetParent !== null)
    const first = focusable[0]
    const last = focusable.at(-1)
    if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first?.focus()
    }
  }

  const tabKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key]
    if (!step) return
    event.preventDefault()
    const index = SECTIONS.findIndex(({ id }) => id === section)
    const next = SECTIONS[(index + step + SECTIONS.length) % SECTIONS.length].id
    setSection(next)
    dialogRef.current?.querySelector<HTMLElement>(`#settings-tab-${next}`)?.focus()
  }

  const panel = (id: SettingsSection) => ({
    role: 'tabpanel',
    id: `settings-panel-${id}`,
    'aria-labelledby': `settings-tab-${id}`,
    className: 'settings-panel',
    hidden: section !== id,
  })

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section ref={dialogRef} className="app-dialog settings-dialog" role="dialog" aria-modal="true" tabIndex={-1}
        aria-labelledby="settings-title" onKeyDown={keyDown}>
        <header>
          <h2 id="settings-title">设置</h2>
          <button type="button" className="icon" onClick={onClose} aria-label="关闭设置"><X /></button>
        </header>
        <form onSubmit={(event) => { event.preventDefault(); void save() }}>
          <div className="settings-layout">
            <div className="settings-tabs" role="tablist" aria-label="设置分类" aria-orientation="vertical" onKeyDown={tabKeyDown}>
              {SECTIONS.map(({ id, label }) => (
                <button key={id} id={`settings-tab-${id}`} type="button" role="tab" aria-selected={section === id}
                  aria-controls={`settings-panel-${id}`} tabIndex={section === id ? 0 : -1} onClick={() => setSection(id)}>
                  {label}
                </button>
              ))}
            </div>

            <fieldset className="settings-panels" disabled={saving}>
              <div {...panel('appearance')}>
                <label>
                  <span>主题</span>
                  <select value={draft.theme} onChange={(event) => set('theme', event.currentTarget.value as Preferences['theme'])}>
                    {THEMES.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                <label>
                  <span>行间距</span>
                  <select value={draft.lineSpacing}
                    onChange={(event) => set('lineSpacing', event.currentTarget.value as Preferences['lineSpacing'])}>
                    {LINE_SPACINGS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                <label>
                  <span>正文字号</span>
                  <select value={draft.fontSize} onChange={(event) => set('fontSize', Number(event.currentTarget.value))}>
                    {FONT_SIZES.map((size) => (
                      <option key={size} value={size}>{`${size} px${size === DEFAULT_PREFERENCES.fontSize ? '（默认）' : ''}`}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>正文宽度</span>
                  <select value={draft.contentWidth}
                    onChange={(event) => set('contentWidth', event.currentTarget.value as Preferences['contentWidth'])}>
                    {CONTENT_WIDTHS.map(({ value, label }) => (
                      <option key={value} value={value}>{`${label}${value === DEFAULT_PREFERENCES.contentWidth ? '（默认）' : ''}`}</option>
                    ))}
                  </select>
                </label>
                <p className="settings-hint">字号与宽度作用于所见即所得和阅读模式。</p>
              </div>

              <div {...panel('editing')}>
                <label className="settings-check">
                  <input type="checkbox" checked={draft.spellcheck} onChange={(event) => set('spellcheck', event.currentTarget.checked)} />
                  <span>拼写检查<small>用红色波浪线标出疑似拼写错误的英文单词，右键可选择建议或加入词典</small></span>
                </label>
                <label>
                  <span>新建代码块的默认语言</span>
                  <select value={draft.codeLanguage} onChange={(event) => set('codeLanguage', event.currentTarget.value)}>
                    {codeLanguages.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                <p className="settings-hint">用于斜杠菜单中的“代码块”、输入 ``` 后回车，以及源码工具栏的代码块按钮。</p>
                <label className="settings-check">
                  <input type="checkbox" checked={draft.autoSave} onChange={(event) => set('autoSave', event.currentTarget.checked)} />
                  <span>自动保存<small>停止输入约 1 秒后自动保存已存盘的文档；未命名文档仍需手动保存</small></span>
                </label>
              </div>

              <div {...panel('startup')}>
                <label className="settings-check">
                  <input type="checkbox" checked={draft.reopenLastDocument}
                    onChange={(event) => set('reopenLastDocument', event.currentTarget.checked)} />
                  <span>启动时打开上次的文档<small>直接启动 Inkdown 时自动打开最近编辑的文档；双击文件打开时不受影响</small></span>
                </label>
                <label>
                  <span>启动时的视图</span>
                  <select value={draft.startupMode}
                    onChange={(event) => set('startupMode', event.currentTarget.value as Preferences['startupMode'])}>
                    {EDITOR_MODES.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
              </div>

              <div {...panel('images')}>
                <p className="dialog-intro">粘贴、拖入或插入的图片会复制到这里，并以相对路径写入文档。已有的图片不会移动。</p>
                {IMAGE_FOLDER_PRESETS.map((preset) => (
                  <label key={preset.mode} className="settings-option">
                    <input type="radio" name="image-folder" checked={draft.imageFolder.mode === preset.mode}
                      onChange={() => set('imageFolder', { mode: preset.mode, template: preset.template })} />
                    <span>{preset.label}<small>{preset.template}</small></span>
                  </label>
                ))}
                <label className="settings-option">
                  <input type="radio" name="image-folder" checked={draft.imageFolder.mode === 'custom'}
                    onChange={() => set('imageFolder', { mode: 'custom', template: custom })} />
                  <span>自定义文件夹<small>相对文档所在文件夹，或填写绝对路径；{'${filename}'} 代表文档名</small></span>
                </label>
                {draft.imageFolder.mode === 'custom' && (
                  <input className="settings-custom" value={custom} aria-label="自定义图片文件夹" placeholder={CUSTOM_PLACEHOLDER}
                    onChange={(event) => { setCustom(event.currentTarget.value); setError(null) }} autoFocus />
                )}
                {!customError && <p className="settings-preview">{describeFolder(imageFolder, documentPath)}</p>}
              </div>
            </fieldset>
          </div>
          {(customError || error) && <p className="dialog-error" role="alert">{customError ?? error}</p>}
          <div className="dialog-actions">
            <button type="button" onClick={onClose}>取消</button>
            <button type="submit" className="primary" disabled={saving || Boolean(customError)}>保存</button>
          </div>
        </form>
      </section>
    </div>
  )
}
