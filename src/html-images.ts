export interface HtmlImage {
  src: string
  alt: string
  title: string
  width: string | null
  height: string | null
  zoom: string | null
}

export interface HtmlImageGroup {
  images: HtmlImage[]
  align: 'left' | 'center' | 'right' | null
}

const WRAPPERS = new Set(['p', 'div', 'center', 'span', 'figure', 'br'])
const LENGTH = /^\d+(?:\.\d+)?(?:px|%)?$/

const styleValue = (style: string, property: string) =>
  new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, 'i').exec(style)?.[1].trim() ?? null

const length = (value: string | null) => {
  if (!value || !LENGTH.test(value)) return null
  return /\d$/.test(value) ? `${value}px` : value
}

/** Typora stores resized images as raw `<img>` HTML; only snippets made of images and simple wrappers qualify. */
export function parseHtmlImages(html: string): HtmlImageGroup | null {
  if (!/<img\b/i.test(html)) return null
  const template = document.createElement('template')
  template.innerHTML = html
  const elements = [...template.content.querySelectorAll('*')]
  if (elements.some((element) => element.localName !== 'img' && !WRAPPERS.has(element.localName))) return null
  if (template.content.textContent?.trim()) return null
  const images = elements.filter((element) => element.localName === 'img').map((image): HtmlImage => {
    const style = image.getAttribute('style') ?? ''
    const zoom = styleValue(style, 'zoom')
    return {
      src: image.getAttribute('src') ?? '',
      alt: image.getAttribute('alt') ?? '',
      title: image.getAttribute('title') ?? '',
      width: length(image.getAttribute('width')) ?? length(styleValue(style, 'width')),
      height: length(image.getAttribute('height')) ?? length(styleValue(style, 'height')),
      zoom: zoom && /^\d+(?:\.\d+)?%?$/.test(zoom) ? zoom : null,
    }
  })
  if (!images.length) return null
  const alignment = template.content.querySelector('center') ? 'center'
    : template.content.querySelector('[align]')?.getAttribute('align')?.toLowerCase()
  return {
    images,
    align: alignment === 'left' || alignment === 'center' || alignment === 'right' ? alignment : null,
  }
}
