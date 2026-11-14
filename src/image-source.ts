export const IMAGE_PROTOCOL = 'inkdown-image'

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.avif', '.apng'])
const KEEP_AS_IS = /^(?:[a-z][a-z\d+.-]*:(?!\\|\/(?!\/))|\/\/|#)/i
const WINDOWS_ABSOLUTE = /^(?:[a-z]:[\\/]|\\\\)/i

const safeDecode = (value: string) => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

const extension = (filePath: string) => {
  const name = filePath.slice(Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/')) + 1)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot).toLowerCase() : ''
}

export function isImagePath(filePath: string): boolean {
  return IMAGE_EXTENSIONS.has(extension(filePath))
}

/** Server of a `\\server\share` path, lower-cased; reading such a path makes Windows sign in to that server. */
export function uncHost(filePath: string | null | undefined): string | null {
  const match = filePath ? /^[\\/]{2}([^\\/]+)[\\/]/.exec(filePath) : null
  return match ? match[1].toLowerCase() : null
}

export function normalizeWindowsPath(filePath: string): string {
  const unc = filePath.startsWith('\\\\')
  const parts = filePath.replace(/^[\\/]+/, '').split(/[\\/]+/)
  const root = unc ? `\\\\${parts.splice(0, 2).join('\\')}` : parts.splice(0, 1)[0].toUpperCase()
  const segments: string[] = []
  for (const part of parts) {
    if (part === '..') segments.pop()
    else if (part && part !== '.') segments.push(part)
  }
  return `${root}\\${segments.join('\\')}`
}

export function toImageUrl(filePath: string): string {
  return `${IMAGE_PROTOCOL}://local/${encodeURIComponent(filePath)}`
}

export function fromImageUrl(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== `${IMAGE_PROTOCOL}:` || parsed.hostname !== 'local') return null
  const filePath = safeDecode(parsed.pathname.slice(1))
  if (filePath.includes('\0') || !WINDOWS_ABSOLUTE.test(filePath) || !isImagePath(filePath)) return null
  return normalizeWindowsPath(filePath)
}

/** Relative to the document folder when the image lives inside it, otherwise an absolute path, as Typora writes it. */
export function markdownImagePath(filePath: string, documentPath: string | null): string {
  const target = filePath.replace(/\\/g, '/')
  if (!documentPath) return target
  const folder = documentPath.replace(/\\/g, '/').replace(/\/[^/]*$/, '/')
  return target.toLowerCase().startsWith(folder.toLowerCase()) ? target.slice(folder.length) : target
}

/** Maps a Markdown image destination to a URL the renderer can load, resolving local paths like Typora does. */
export function resolveImageSource(source: string, documentPath: string | null): string {
  const raw = source.trim()
  if (!raw) return source
  let target = raw
  if (/^file:/i.test(target)) {
    target = target.replace(/^file:\/*/i, '')
    if (!/^[a-z]:/i.test(target)) target = `\\\\${target}`
  } else if (KEEP_AS_IS.test(target)) {
    return source
  }
  target = target.replace(/\?.*$/, '')
  const hash = target.indexOf('#')
  if (hash > 0 && isImagePath(target.slice(0, hash))) target = target.slice(0, hash)
  target = safeDecode(target)

  let absolute: string
  if (WINDOWS_ABSOLUTE.test(target)) {
    absolute = target
  } else if (/^[\\/]/.test(target)) {
    if (!documentPath || !/^[a-z]:/i.test(documentPath)) return source
    absolute = `${documentPath.slice(0, 2)}${target}`
  } else {
    if (!documentPath) return source
    absolute = `${documentPath.slice(0, Math.max(documentPath.lastIndexOf('\\'), documentPath.lastIndexOf('/')))}\\${target}`
  }
  const normalized = normalizeWindowsPath(absolute)
  return isImagePath(normalized) ? toImageUrl(normalized) : source
}
