import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { decodeUtf8, detectFormat, FileService, UTF8_BOM } from '../electron/main/file-service'
import { isDocumentContent, isDocumentPath, isSafeExternalUrl } from '../electron/main/validators'
import { restoreBounds } from '../electron/main/window-state'
import { decisionFromDialog } from '../electron/main/unsaved-decision'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
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
    expect(decodeUtf8(Buffer.from(`${UTF8_BOM}正文`))).toBe('正文')
  })

  it('保存时保留原文件的 CRLF 换行和 BOM，编辑器内统一使用 LF', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), '换行-'))
    temporaryDirectories.push(directory)
    const filePath = path.join(directory, 'windows.md')
    await writeFile(filePath, `${UTF8_BOM}# 标题\r\n\r\n正文\r\n`, 'utf8')
    const service = new FileService()
    const loaded = await service.read(filePath)
    expect(loaded.content).toBe('# 标题\n\n正文\n')
    expect(loaded.format).toEqual({ bom: true, eol: '\r\n' })
    await service.write(filePath, '# 标题\n\n修改后的正文\n', loaded.format)
    expect(await readFile(filePath, 'utf8')).toBe(`${UTF8_BOM}# 标题\r\n\r\n修改后的正文\r\n`)
    await service.write(filePath, '一行\r\n两行')
    expect(await readFile(filePath, 'utf8')).toBe('一行\n两行')
    expect(detectFormat('a\nb\r\nc\n')).toEqual({ bom: false, eol: '\n' })
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

  it('仅恢复仍位于可见屏幕内的窗口边界', () => {
    const displays = [{ x: 0, y: 0, width: 1920, height: 1080 }]
    expect(restoreBounds({ x: 100, y: 80, width: 1200, height: 700 }, displays))
      .toEqual({ x: 100, y: 80, width: 1200, height: 700 })
    expect(restoreBounds({ x: 8000, y: 8000, width: 1200, height: 700 }, displays))
      .toEqual({ width: 1200, height: 700 })
    expect(restoreBounds({ width: 200, height: 100 }, displays))
      .toEqual({ width: 800, height: 560 })
  })

  it('将未保存确认按钮映射为确定状态机决策', () => {
    expect(decisionFromDialog(0)).toBe('save')
    expect(decisionFromDialog(1)).toBe('discard')
    expect(decisionFromDialog(2)).toBe('cancel')
    expect(decisionFromDialog(-1)).toBe('cancel')
  })
})
