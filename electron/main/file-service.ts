import { randomBytes } from 'node:crypto'
import { open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { errorCode } from './file-errors'
import { isDocumentPath } from './validators'

export const UTF8_BOM = '\uFEFF'
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024

export type TextEncoding = 'utf8' | 'utf16le' | 'utf16be'

/** How a document is stored on disk, so saving keeps its encoding, line endings and byte order mark intact. */
export interface TextFormat {
  bom: boolean
  eol: '\n' | '\r\n'
  encoding: TextEncoding
}

export const DEFAULT_TEXT_FORMAT: TextFormat = { bom: false, eol: '\n', encoding: 'utf8' }

export interface DecodedText {
  text: string
  encoding: TextEncoding
  bom: boolean
  /** Set when the bytes were not Unicode; such files are saved back as UTF-8. */
  legacy?: 'gb18030'
}

/**
 * UTF-8 decoding replaced the bytes of GBK files (common for older Chinese notes) and UTF-16 files (PowerShell's
 * default) with U+FFFD, and the next save destroyed the original text.
 */
export function decodeText(bytes: Uint8Array): DecodedText {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf8', bom: true }
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf16le', bom: true }
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'utf16be', bom: true }
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf8', bom: false }
  } catch {
    return { text: new TextDecoder('gb18030').decode(bytes), encoding: 'utf8', bom: false, legacy: 'gb18030' }
  }
}

export function encodeText(text: string, format: TextFormat): Buffer {
  if (format.encoding === 'utf8') return Buffer.from((format.bom ? UTF8_BOM : '') + text, 'utf8')
  const body = Buffer.from(text, 'utf16le')
  if (format.encoding === 'utf16be') body.swap16()
  return Buffer.concat([Buffer.from(format.encoding === 'utf16le' ? [0xff, 0xfe] : [0xfe, 0xff]), body])
}

export function detectEol(text: string): TextFormat['eol'] {
  const crlf = text.match(/\r\n/g)?.length ?? 0
  const lf = (text.match(/\n/g)?.length ?? 0) - crlf
  return crlf > lf ? '\r\n' : '\n'
}

const REPLACE_ERRORS = new Set(['EPERM', 'EACCES', 'EBUSY'])
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function writeInPlace(filePath: string, data: Buffer): Promise<void> {
  let handle
  try {
    handle = await open(filePath, 'r+')
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error
    await writeFile(filePath, data, { flush: true })
    return
  }
  try {
    await handle.truncate(0)
    await handle.write(data, 0, data.length, 0)
    await handle.sync()
  } finally {
    await handle.close()
  }
}

/**
 * Writes beside the target and renames over it, so a full disk or a crash mid-write leaves the old file intact.
 * Files that cannot be replaced (held open without delete sharing, hidden, or in a folder that refuses new files)
 * are rewritten in place instead.
 */
export async function writeAtomically(filePath: string, data: Buffer): Promise<void> {
  const temp = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomBytes(4).toString('hex')}.tmp`)
  try {
    await writeFile(temp, data, { flag: 'wx', flush: true })
  } catch (error) {
    await unlink(temp).catch(() => undefined)
    if (!REPLACE_ERRORS.has(errorCode(error) ?? '')) throw error
    return writeInPlace(filePath, data)
  }
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(temp, filePath)
      return
    } catch (error) {
      // Antivirus scanners briefly lock freshly written files.
      if (REPLACE_ERRORS.has(errorCode(error) ?? '') && attempt < 3) {
        await delay(60)
        continue
      }
      await unlink(temp).catch(() => undefined)
      if (!REPLACE_ERRORS.has(errorCode(error) ?? '')) throw error
      return writeInPlace(filePath, data)
    }
  }
}

export interface LoadedDocument {
  content: string
  modifiedAt: number
  format: TextFormat
  legacy?: DecodedText['legacy']
}

export class FileService {
  async read(filePath: string): Promise<LoadedDocument> {
    if (!isDocumentPath(filePath)) throw new Error('不支持的文件路径或类型')
    const info = await stat(filePath)
    if (info.size > MAX_DOCUMENT_BYTES) throw Object.assign(new Error('文件过大'), { code: 'TOO_LARGE' })
    const decoded = decodeText(await readFile(filePath))
    return {
      content: decoded.text.replace(/\r\n/g, '\n'),
      modifiedAt: info.mtimeMs,
      format: { bom: decoded.bom, eol: detectEol(decoded.text), encoding: decoded.encoding },
      legacy: decoded.legacy,
    }
  }

  async write(filePath: string, content: string, format: TextFormat = DEFAULT_TEXT_FORMAT): Promise<number> {
    if (!isDocumentPath(filePath)) throw new Error('不支持的文件路径或类型')
    const body = content.replace(/\r\n/g, '\n').replace(/\n/g, format.eol)
    await writeAtomically(filePath, encodeText(body, format))
    return (await stat(filePath)).mtimeMs
  }

  displayName(filePath: string | null): string {
    return filePath ? path.basename(filePath) : '未命名.md'
  }
}
