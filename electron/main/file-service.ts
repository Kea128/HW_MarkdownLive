import { readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { isDocumentPath } from './validators'

export const UTF8_BOM = '\uFEFF'

/** How a document is stored on disk, so saving keeps Windows line endings and a byte order mark intact. */
export interface TextFormat {
  bom: boolean
  eol: '\n' | '\r\n'
}

export const DEFAULT_TEXT_FORMAT: TextFormat = { bom: false, eol: '\n' }

export function decodeUtf8(buffer: Buffer): string {
  const text = buffer.toString('utf8')
  return text.startsWith(UTF8_BOM) ? text.slice(1) : text
}

export function detectFormat(text: string): TextFormat {
  const crlf = text.match(/\r\n/g)?.length ?? 0
  const lf = (text.match(/\n/g)?.length ?? 0) - crlf
  return { bom: text.startsWith(UTF8_BOM), eol: crlf > lf ? '\r\n' : '\n' }
}

export class FileService {
  async read(filePath: string): Promise<{ content: string; modifiedAt: number; format: TextFormat }> {
    if (!isDocumentPath(filePath)) throw new Error('不支持的文件路径或类型')
    const [buffer, info] = await Promise.all([readFile(filePath), stat(filePath)])
    const text = buffer.toString('utf8')
    return {
      content: decodeUtf8(buffer).replace(/\r\n/g, '\n'),
      modifiedAt: info.mtimeMs,
      format: detectFormat(text),
    }
  }

  async write(filePath: string, content: string, format: TextFormat = DEFAULT_TEXT_FORMAT): Promise<number> {
    if (!isDocumentPath(filePath)) throw new Error('不支持的文件路径或类型')
    const body = content.replace(/\r\n/g, '\n').replace(/\n/g, format.eol)
    await writeFile(filePath, (format.bom ? UTF8_BOM : '') + body, { encoding: 'utf8', flag: 'w' })
    return (await stat(filePath)).mtimeMs
  }

  displayName(filePath: string | null): string {
    return filePath ? path.basename(filePath) : '未命名.md'
  }
}
