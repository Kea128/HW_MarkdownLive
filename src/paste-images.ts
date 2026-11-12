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

export async function storeImage(file: File): Promise<StoreResult> {
  const sourcePath = window.inkdown.document.pathForFile(file)
  let result: ImageSaveResult
  try {
    result = await window.inkdown.images.save(sourcePath
      ? { name: file.name, type: file.type, sourcePath }
      : { name: file.name, type: file.type, data: new Uint8Array(await file.arrayBuffer()) })
  } catch {
    return { error: '无法保存图片' }
  }
  if (!result.ok) return { error: result.error }
  const fileName = result.src.slice(result.src.lastIndexOf('/') + 1)
  return { src: result.src, alt: fileName.replace(/\.[^.]+$/, ''), notice: notices[result.location](result.src) }
}

export async function storeImages(files: File[], notify: (message: string) => void): Promise<StoredImage[]> {
  const results = await Promise.all(files.map(storeImage))
  const stored = results.filter((item): item is StoredImage => 'src' in item)
  const failure = results.find((item): item is { error: string } => 'error' in item)
  if (failure) notify(failure.error)
  else if (stored.length) notify(stored.length === 1 ? stored[0].notice : `已插入 ${stored.length} 张图片（${stored[0].notice}）`)
  return stored
}

export function imageMarkdown({ src, alt }: { src: string; alt: string }): string {
  const destination = /[\s()<>]/.test(src) ? `<${src}>` : src
  return `![${alt.replace(/[[\]\\]/g, '\\$&')}](${destination})`
}
