import type { ImageFolderMode, ImageFolderSetting } from './contracts'

export const IMAGE_FOLDER_PRESETS: Array<{ mode: Exclude<ImageFolderMode, 'custom'>; template: string; label: string }> = [
  { mode: 'document-assets', template: '${filename}.assets', label: '与文档同名的 .assets 文件夹（推荐）' },
  { mode: 'document-name', template: '${filename}', label: '与文档同名的文件夹' },
  { mode: 'shared-assets', template: 'assets', label: '文档所在目录的 assets 文件夹' },
]

export const DEFAULT_IMAGE_FOLDER: ImageFolderSetting = { mode: 'document-assets', template: '${filename}.assets' }

export function folderTemplate(setting: ImageFolderSetting): string {
  return IMAGE_FOLDER_PRESETS.find(({ mode }) => mode === setting.mode)?.template ?? setting.template.trim()
}

export function expandFolderTemplate(template: string, documentName: string): string {
  return template.trim().replace(/\$\{filename\}/g, documentName)
}

/** Returns an error message, or null when Windows can create the folder. */
export function validateFolderTemplate(template: string): string | null {
  const value = template.trim()
  if (!value) return '请填写图片文件夹'
  if (value.length > 200) return '路径过长'
  if ([...value].some((char) => char < ' ')) return '路径包含控制字符'
  if (/[<>"|?*]/.test(value)) return '路径不能包含 < > " | ? *'
  if (value.replace(/^[a-z]:(?=[\\/])/i, '').includes(':')) return '冒号只能用于盘符，例如 D:\\图片'
  const segments = value.replace(/^[a-z]:/i, '').split(/[\\/]+/).filter(Boolean)
  if (segments.some((segment) => segment !== '.' && segment !== '..' && /[. ]$/.test(segment))) {
    return '文件夹名称不能以空格或句点结尾'
  }
  return null
}

export function isImageFolderSetting(value: unknown): value is ImageFolderSetting {
  if (!value || typeof value !== 'object') return false
  const { mode, template } = value as Record<string, unknown>
  if (typeof template !== 'string') return false
  if (mode === 'custom') return validateFolderTemplate(template) === null
  return IMAGE_FOLDER_PRESETS.some((preset) => preset.mode === mode)
}
