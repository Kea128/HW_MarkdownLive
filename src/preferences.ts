import type { ContentWidth, EditorMode, LineSpacing, Preferences, PreferencesResult, Theme } from './contracts'
import { DEFAULT_IMAGE_FOLDER, isImageFolderSetting, validateFolderTemplate } from './image-folder'

export const THEMES: Array<{ value: Theme; label: string }> = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
]

export const LINE_SPACINGS: Array<{ value: LineSpacing; label: string }> = [
  { value: 'compact', label: '紧凑' },
  { value: 'standard', label: '标准' },
  { value: 'relaxed', label: '宽松' },
]

export const FONT_SIZES = [14, 15, 16, 17, 18, 20, 22]

export const CONTENT_WIDTHS: Array<{ value: ContentWidth; label: string; css: string }> = [
  { value: 'narrow', label: '适中，便于阅读', css: '960px' },
  { value: 'wide', label: '较宽', css: '1440px' },
  { value: 'full', label: '铺满窗口', css: '100%' },
]

export const EDITOR_MODES: Array<{ value: EditorMode; label: string }> = [
  { value: 'visual', label: '所见即所得' },
  { value: 'source', label: 'Markdown 源码' },
  { value: 'reading', label: '阅读（只读）' },
]

export const CODE_LANGUAGES: Array<{ value: string; label: string }> = [
  { value: '', label: '不指定' },
  { value: 'text', label: '纯文本 (text)' },
  { value: 'bash', label: 'Shell / Bash' },
  { value: 'python', label: 'Python' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'json', label: 'JSON' },
  { value: 'yaml', label: 'YAML' },
  { value: 'java', label: 'Java' },
  { value: 'c', label: 'C' },
  { value: 'cpp', label: 'C++' },
  { value: 'csharp', label: 'C#' },
  { value: 'go', label: 'Go' },
  { value: 'rust', label: 'Rust' },
  { value: 'sql', label: 'SQL' },
  { value: 'html', label: 'HTML' },
  { value: 'css', label: 'CSS' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'mermaid', label: 'Mermaid' },
]

export const DEFAULT_PREFERENCES: Preferences = {
  theme: 'system',
  lineSpacing: 'standard',
  fontSize: 17,
  contentWidth: 'wide',
  spellcheck: false,
  codeLanguage: 'text',
  autoSave: false,
  reopenLastDocument: true,
  startupMode: 'visual',
  imageFolder: DEFAULT_IMAGE_FOLDER,
}

const isOneOf = <T>(options: Array<{ value: T }>) => (value: unknown): value is T =>
  options.some((option) => option.value === value)
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean'

const validators: { [K in keyof Preferences]: (value: unknown) => value is Preferences[K] } = {
  theme: isOneOf(THEMES),
  lineSpacing: isOneOf(LINE_SPACINGS),
  fontSize: (value): value is number => FONT_SIZES.includes(value as number),
  contentWidth: isOneOf(CONTENT_WIDTHS),
  spellcheck: isBoolean,
  codeLanguage: (value): value is string => typeof value === 'string' && /^[\w+#.-]{0,32}$/.test(value),
  autoSave: isBoolean,
  reopenLastDocument: isBoolean,
  startupMode: isOneOf(EDITOR_MODES),
  imageFolder: isImageFolderSetting,
}

const isPreferenceKey = (key: string): key is keyof Preferences => Object.hasOwn(validators, key)

/** Keeps every valid field of a stored or partial value and falls back to the default for the rest. */
export function readPreferences(value: unknown): Preferences {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const preferences: Preferences = { ...DEFAULT_PREFERENCES }
  for (const key of Object.keys(validators).filter(isPreferenceKey)) {
    const candidate = source[key]
    if (validators[key](candidate)) Object.assign(preferences, { [key]: candidate })
  }
  const { mode, template } = preferences.imageFolder
  preferences.imageFolder = { mode, template: template.trim() }
  return preferences
}

export function mergePreferences(current: Preferences, patch: unknown): PreferencesResult {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { ok: false, error: '设置无效' }
  for (const [key, value] of Object.entries(patch)) {
    if (!isPreferenceKey(key)) return { ok: false, error: '包含未知的设置项' }
    if (validators[key](value)) continue
    if (key !== 'imageFolder') return { ok: false, error: '设置值无效' }
    const template = (value as { template?: unknown } | null)?.template
    return { ok: false, error: (typeof template === 'string' && validateFolderTemplate(template)) || '图片文件夹设置无效' }
  }
  return { ok: true, value: readPreferences({ ...current, ...patch }) }
}

export function contentWidthCss(width: ContentWidth): string {
  return CONTENT_WIDTHS.find(({ value }) => value === width)?.css ?? '1440px'
}
