import { readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { isDocumentPath } from './validators'

export const UTF8_BOM = '\uFEFF'

export function decodeUtf8(buffer: Buffer): string {
  const text = buffer.toString('utf8')
  return text.startsWith(UTF8_BOM) ? text.slice(1) : text
}

export class FileService {
  async read(filePath: string): Promise<{ content: string; modifiedAt: number }> {
    if (!isDocumentPath(filePath)) throw new Error('不支持的文件路径或类型')
    const [buffer, info] = await Promise.all([readFile(filePath), stat(filePath)])
    return { content: decodeUtf8(buffer), modifiedAt: info.mtimeMs }
  }

  async write(filePath: string, content: string): Promise<number> {
    if (!isDocumentPath(filePath)) throw new Error('不支持的文件路径或类型')
    await writeFile(filePath, content, { encoding: 'utf8', flag: 'w' })
    return (await stat(filePath)).mtimeMs
  }

  displayName(filePath: string | null): string {
    return filePath ? path.basename(filePath) : '未命名.md'
  }
}
