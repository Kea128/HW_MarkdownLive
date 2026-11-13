import type { ImageSaveResult } from './contracts'
import { isImagePath } from './image-source'

export interface StoredImage {
  src: string
  alt: string
  notice: string
}

export type StoreResult = StoredImage | { error: string }

export const isImageFile = (file: File) => file.type.startsWith('image/') || isImagePath(file.name)

export function imageFiles(data: DataTransfer | null): File[] {
  return Array.from(data?.files ?? []).filter(isImageFile)
}

export function draggingImages(data: DataTransfer | null): boolean {
  return Array.from(data?.items ?? []).some((item) => item.kind === 'file' && item.type.startsWith('image/'))
}

/** Word, Excel and web selections also put a picture of the selection on the clipboard; their text must win. */
export function shouldPasteImages(data: DataTransfer | null): boolean {
  if (!imageFiles(data).length) return false
  const html = data?.getData('text/html') ?? ''
  if (!html.trim()) return true
  const template = document.createElement('template')
  template.innerHTML = html
  template.content.querySelectorAll('meta, style, script, title, link').forEach((element) => element.remove())
  return !template.content.textContent?.trim() && template.content.querySelector('img') !== null
}

const notices: Record<Extract<ImageSaveResult, { ok: true }>['location'], (src: string) => string> = {
  saved: (src) => `图片已保存到 ${src}`,
  linked: (src) => `已插入图片 ${src}`,
  staged: () => '图片已暂存，保存文档后会自动移到图片文件夹',
}

function toStored(result: ImageSaveResult): StoreResult {
  if (!result.ok) return { error: result.error }
  const fileName = result.src.slice(result.src.lastIndexOf('/') + 1)
  return { src: result.src, alt: fileName.replace(/\.[^.]+$/, ''), notice: notices[result.location](result.src) }
}

export async function storeImage(file: File): Promise<StoreResult> {
  const sourcePath = window.inkdown.document.pathForFile(file)
  try {
    return toStored(await window.inkdown.images.save(sourcePath
      ? { name: file.name, type: file.type, sourcePath }
      : { name: file.name, type: file.type, data: new Uint8Array(await file.arrayBuffer()) }))
  } catch {
    return { error: '无法保存图片' }
  }
}

function report(results: StoreResult[], notify: (message: string) => void): StoredImage[] {
  const stored = results.filter((item): item is StoredImage => 'src' in item)
  const failure = results.find((item): item is { error: string } => 'error' in item)
  if (failure) notify(failure.error)
  else if (stored.length) notify(stored.length === 1 ? stored[0].notice : `已插入 ${stored.length} 张图片（${stored[0].notice}）`)
  return stored
}

export async function storeImages(files: File[], notify: (message: string) => void): Promise<StoredImage[]> {
  return report(await Promise.all(files.map(storeImage)), notify)
}

/** Lets the user pick image files; they are copied into the document's image folder like dropped files. */
export async function chooseImages(notify: (message: string) => void): Promise<StoredImage[]> {
  try {
    return report((await window.inkdown.images.choose()).map(toStored), notify)
  } catch {
    notify('无法插入图片')
    return []
  }
}

export async function openImage(src: string, notify: (message: string) => void): Promise<void> {
  const opened = /^https?:/i.test(src.trim())
    ? await window.inkdown.external.open(src.trim())
    : await window.inkdown.images.open(src)
  if (!opened) notify('找不到图片文件')
}

export function imageMarkdown({ src, alt }: { src: string; alt: string }): string {
  const destination = /[\s()<>]/.test(src) ? `<${src}>` : src
  return `![${alt.replace(/[[\]\\]/g, '\\$&')}](${destination})`
}
