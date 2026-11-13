import type { HtmlImage, HtmlImageGroup } from './html-images'

export type ImageAlign = 'left' | 'center' | 'right'

export interface ImageModel {
  src: string
  alt: string
  title: string
  /** `480` (CSS pixels) or `50%` of the text column. */
  width: string | null
  zoom: string | null
  align: ImageAlign
}

export const IMAGE_SIZE_PRESETS = ['25%', '50%', '75%', '100%']
export const MIN_IMAGE_WIDTH = 32

const escapeAttribute = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function markdownImageModel(attrs: { src?: unknown; alt?: unknown; title?: unknown }): ImageModel {
  return {
    src: String(attrs.src ?? ''),
    alt: String(attrs.alt ?? ''),
    title: String(attrs.title ?? ''),
    width: null,
    zoom: null,
    align: 'left',
  }
}

export function htmlImageModel(image: HtmlImage, align: HtmlImageGroup['align']): ImageModel {
  return {
    src: image.src,
    alt: image.alt,
    title: image.title,
    width: image.width?.replace(/px$/, '') ?? null,
    zoom: image.zoom,
    align: align ?? 'left',
  }
}

/** Without a size or alignment the image is written back as plain Markdown. */
export function isPlainImage(model: ImageModel): boolean {
  return !model.width && !model.zoom && model.align === 'left'
}

/** Typora and GitHub both render sized and aligned images written as HTML. */
export function imageHtml(model: ImageModel): string {
  const attributes = [`src="${escapeAttribute(model.src)}"`, `alt="${escapeAttribute(model.alt)}"`]
  if (model.title) attributes.push(`title="${escapeAttribute(model.title)}"`)
  if (model.width) attributes.push(`width="${model.width}"`)
  else if (model.zoom) attributes.push(`style="zoom:${model.zoom};"`)
  const image = `<img ${attributes.join(' ')} />`
  return model.align === 'left' ? image : `<p align="${model.align}">${image}</p>`
}

export function describeSize(model: ImageModel): string {
  if (model.width) return model.width.endsWith('%') ? model.width : `${model.width} px`
  if (model.zoom) return `缩放 ${model.zoom}`
  return '原始大小'
}

export const isLocalImage = (src: string) => !/^(?:https?:|data:|blob:)/i.test(src.trim())
