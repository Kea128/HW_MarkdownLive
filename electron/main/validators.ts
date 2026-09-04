import path from 'node:path'

const documentExtensions = new Set(['.md', '.markdown', '.txt'])
const externalProtocols = new Set(['http:', 'https:', 'mailto:'])

export function isDocumentPath(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 32_767
    && path.isAbsolute(value)
    && documentExtensions.has(path.extname(value).toLowerCase())
}

export function isDocumentContent(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 50 * 1024 * 1024
}

export function isSafeExternalUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 8_192) return false
  try {
    return externalProtocols.has(new URL(value).protocol)
  } catch {
    return false
  }
}
