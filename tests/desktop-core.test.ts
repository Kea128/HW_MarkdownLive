import { mkdtemp, readdir, readFile, rm, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { describeFileError } from '../electron/main/file-errors'
import {
  decodeText, detectEol, encodeText, FileService, MAX_DOCUMENT_BYTES, UTF8_BOM, writeAtomically,
} from '../electron/main/file-service'
import { isDocumentContent, isDocumentPath, isSafeExternalUrl } from '../electron/main/validators'
import { restoreBounds } from '../electron/main/window-state'
import { decisionFromDialog } from '../electron/main/unsaved-decision'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })))
})

describe('桌面文件服务与边界验证', () => {
  it('读取 UTF-8 BOM 与中文路径，并以 UTF-8 覆盖保存', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), '墨水-'))
    temporaryDirectories.push(directory)
    const filePath = path.join(directory, '中文文稿.md')
    await writeFile(filePath, `${UTF8_BOM}# 中文\n内容`, 'utf8')
    const service = new FileService()
    expect((await service.read(filePath)).content).toBe('# 中文\n内容')
    await service.write(filePath, '# 已保存')
    expect(await readFile(filePath, 'utf8')).toBe('# 已保存')
    expect(decodeText(Buffer.from(`${UTF8_BOM}正文`))).toEqual({ text: '正文', encoding: 'utf8', bom: true })
    expect(await readdir(directory)).toEqual(['中文文稿.md'])
  })

  it('GBK 文件按 GB18030 读取并标记转换，UTF-16 文件保持原编码保存', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), '编码-'))
    temporaryDirectories.push(directory)
    const gbk = path.join(directory, '旧笔记.txt')
    await writeFile(gbk, Buffer.from([0xc4, 0xe3, 0xba, 0xc3, 0x0a]))
    const service = new FileService()
    const legacy = await service.read(gbk)
    expect(legacy).toMatchObject({ content: '你好\n', legacy: 'gb18030', format: { encoding: 'utf8', bom: false } })
    await service.write(gbk, '你好，世界\n', legacy.format)
    expect(await readFile(gbk, 'utf8')).toBe('你好，世界\n')

    const utf16 = path.join(directory, 'powershell.md')
    await writeFile(utf16, encodeText('# 标题\r\n内容', { encoding: 'utf16le', bom: true, eol: '\r\n' }))
    const loaded = await service.read(utf16)
    expect(loaded).toMatchObject({ content: '# 标题\n内容', format: { encoding: 'utf16le', bom: true, eol: '\r\n' } })
    await service.write(utf16, '# 标题\n已修改', loaded.format)
    const bytes = await readFile(utf16)
    expect([...bytes.subarray(0, 2)]).toEqual([0xff, 0xfe])
    expect(decodeText(bytes).text).toBe('# 标题\r\n已修改')
    expect(decodeText(encodeText('A', { encoding: 'utf16be', bom: true, eol: '\n' }))).toEqual({ text: 'A', encoding: 'utf16be', bom: true })
  })

  it('原子写入不留下临时文件，过大的文档拒绝打开并给出中文原因', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), '原子-'))
    temporaryDirectories.push(directory)
    const filePath = path.join(directory, '大.md')
    await writeAtomically(filePath, Buffer.from('一'))
    await writeAtomically(filePath, Buffer.from('二'))
    expect(await readFile(filePath, 'utf8')).toBe('二')
    expect(await readdir(directory)).toEqual(['大.md'])
    await truncate(filePath, MAX_DOCUMENT_BYTES + 1)
    const error = await new FileService().read(filePath).catch((reason: unknown) => reason)
    expect(describeFileError(error, '打开文件')).toBe('无法打开文件：文件超过 20 MB，Inkdown 无法流畅编辑这么大的文档')
    expect(describeFileError(Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' }), '打开文件'))
      .toBe('无法打开文件：文件不存在或已被移动')
    expect(describeFileError(new Error('其他原因'), '保存文件')).toBe('无法保存文件：其他原因')
  })

  it('保存时保留原文件的 CRLF 换行和 BOM，编辑器内统一使用 LF', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), '换行-'))
    temporaryDirectories.push(directory)
    const filePath = path.join(directory, 'windows.md')
    await writeFile(filePath, `${UTF8_BOM}# 标题\r\n\r\n正文\r\n`, 'utf8')
    const service = new FileService()
    const loaded = await service.read(filePath)
    expect(loaded.content).toBe('# 标题\n\n正文\n')
    expect(loaded.format).toEqual({ bom: true, eol: '\r\n', encoding: 'utf8' })
    await service.write(filePath, '# 标题\n\n修改后的正文\n', loaded.format)
    expect(await readFile(filePath, 'utf8')).toBe(`${UTF8_BOM}# 标题\r\n\r\n修改后的正文\r\n`)
    await service.write(filePath, '一行\r\n两行')
    expect(await readFile(filePath, 'utf8')).toBe('一行\n两行')
    expect(detectEol('a\nb\r\nc\n')).toBe('\n')
  })

  it('拒绝不受支持路径、过大内容和危险外链协议', () => {
    expect(isDocumentPath(path.resolve('safe.markdown'))).toBe(true)
    expect(isDocumentPath(path.resolve('unsafe.exe'))).toBe(false)
    expect(isDocumentPath('../relative.md')).toBe(false)
    expect(isDocumentContent('正文')).toBe(true)
    expect(isSafeExternalUrl('https://example.com/path')).toBe(true)
    expect(isSafeExternalUrl('mailto:user@example.com')).toBe(true)
    expect(isSafeExternalUrl('file:///C:/secret.txt')).toBe(false)
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false)
  })

  it('仅恢复仍位于可见屏幕内的窗口边界，并缩小到屏幕能容纳的大小', () => {
    const displays = [{ x: 0, y: 0, width: 1920, height: 1080 }]
    expect(restoreBounds({ x: 100, y: 80, width: 1200, height: 700 }, displays))
      .toEqual({ x: 100, y: 80, width: 1200, height: 700 })
    expect(restoreBounds({ x: 8000, y: 8000, width: 1200, height: 700 }, displays))
      .toEqual({ width: 1200, height: 700 })
    expect(restoreBounds({ width: 200, height: 100 }, displays))
      .toEqual({ width: 800, height: 560 })
    const laptop = [{ x: 0, y: 0, width: 1366, height: 728 }]
    expect(restoreBounds({ x: 600, y: 200, width: 2400, height: 1300 }, laptop))
      .toEqual({ x: 0, y: 0, width: 1366, height: 728 })
    expect(restoreBounds(undefined, laptop)).toEqual({ width: 1280, height: 728 })
  })

  it('将未保存确认按钮映射为确定状态机决策', () => {
    expect(decisionFromDialog(0)).toBe('save')
    expect(decisionFromDialog(1)).toBe('discard')
    expect(decisionFromDialog(2)).toBe('cancel')
    expect(decisionFromDialog(-1)).toBe('cancel')
  })
})
