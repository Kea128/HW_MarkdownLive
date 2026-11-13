import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { X } from 'lucide-react'
import type { ImageFolderSetting } from './contracts'
import {
  DEFAULT_IMAGE_FOLDER, expandFolderTemplate, folderTemplate, IMAGE_FOLDER_PRESETS, validateFolderTemplate,
} from './image-folder'

interface Props {
  documentPath: string | null
  onClose(): void
  onSaved(message: string): void
}

const CUSTOM_PLACEHOLDER = 'images/${filename}'

function describeFolder(setting: ImageFolderSetting, documentPath: string | null): string {
  const name = documentPath?.replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '') ?? '文档名'
  const folder = expandFolderTemplate(folderTemplate(setting), name)
  const absolute = /^(?:[a-z]:[\\/]|\\\\)/i.test(folder)
  const document = documentPath ? `“${name}”的图片` : '图片'
  return absolute ? `${document}将保存到 ${folder}` : `${document}将保存到文档所在文件夹下的 ${folder}`
}

export function SettingsDialog({ documentPath, onClose, onSaved }: Props) {
  const [setting, setSetting] = useState<ImageFolderSetting | null>(null)
  const [custom, setCustom] = useState(CUSTOM_PLACEHOLDER)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const dialogRef = useRef<HTMLElement>(null)

  useEffect(() => {
    let active = true
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const apply = (current: ImageFolderSetting) => {
      if (!active) return
      setSetting(current)
      if (current.mode === 'custom') setCustom(current.template)
      requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLInputElement>('input[type="radio"]:checked')?.focus())
    }
    void window.inkdown.settings.getImageFolder().then(apply, () => apply(DEFAULT_IMAGE_FOLDER))
    return () => {
      active = false
      previous?.focus()
    }
  }, [])

  const choice: ImageFolderSetting | null = setting && (setting.mode === 'custom' ? { mode: 'custom', template: custom } : setting)
  const customError = setting?.mode === 'custom' ? validateFolderTemplate(custom) : null

  const save = async () => {
    if (!choice || customError) return
    setSaving(true)
    const result = await window.inkdown.settings.setImageFolder(choice).catch(() => ({ ok: false as const, error: '无法保存设置' }))
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onSaved('已更新图片保存位置，之后粘贴或插入的图片会保存到新位置')
    onClose()
  }

  const keyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    onClose()
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section ref={dialogRef} className="app-dialog settings-dialog" role="dialog" aria-modal="true"
        aria-labelledby="settings-title" onKeyDown={keyDown}>
        <header>
          <h2 id="settings-title">设置</h2>
          <button type="button" className="icon" onClick={onClose} aria-label="关闭设置"><X /></button>
        </header>
        <form onSubmit={(event) => { event.preventDefault(); void save() }}>
          <fieldset className="settings-group" disabled={!setting || saving}>
            <legend>图片保存位置</legend>
            <p className="dialog-intro">粘贴、拖入或插入的图片会复制到这里，并以相对路径写入文档。已有的图片不会移动。</p>
            {IMAGE_FOLDER_PRESETS.map((preset) => (
              <label key={preset.mode} className="settings-option">
                <input type="radio" name="image-folder" checked={setting?.mode === preset.mode}
                  onChange={() => { setSetting({ mode: preset.mode, template: preset.template }); setError(null) }} />
                <span>{preset.label}<small>{preset.template}</small></span>
              </label>
            ))}
            <label className="settings-option">
              <input type="radio" name="image-folder" checked={setting?.mode === 'custom'}
                onChange={() => { setSetting({ mode: 'custom', template: custom }); setError(null) }} />
              <span>自定义文件夹<small>相对文档所在文件夹，或填写绝对路径；{'${filename}'} 代表文档名</small></span>
            </label>
            {setting?.mode === 'custom' && (
              <input className="settings-custom" value={custom} aria-label="自定义图片文件夹" placeholder={CUSTOM_PLACEHOLDER}
                onChange={(event) => { setCustom(event.currentTarget.value); setError(null) }} autoFocus />
            )}
            {choice && !customError && <p className="settings-preview">{describeFolder(choice, documentPath)}</p>}
          </fieldset>
          {(customError || error) && <p className="dialog-error" role="alert">{customError ?? error}</p>}
          <div className="dialog-actions">
            <button type="button" onClick={onClose}>取消</button>
            <button type="submit" className="primary" disabled={!setting || saving || Boolean(customError)}>保存</button>
          </div>
        </form>
      </section>
    </div>
  )
}
