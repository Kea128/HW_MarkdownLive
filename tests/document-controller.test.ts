import { mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({ showMessageBox: vi.fn(), showOpenDialog: vi.fn(), showSaveDialog: vi.fn() }))
vi.mock('electron', () => ({ dialog: electron }))

import { DocumentController, type ImageRelocator } from '../electron/main/document-controller'
import { FileService } from '../electron/main/file-service'
import type { DocumentSnapshot } from '../src/contracts'

const directories: string[] = []

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
})

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })))
})

async function controller(relocate?: ImageRelocator) {
  const directory = await mkdtemp(path.join(tmpdir(), '文档-'))
  directories.push(directory)
  const filePath = path.join(directory, '笔记.md')
  await writeFile(filePath, '原文', 'utf8')
  const published: Array<{ snapshot: DocumentSnapshot; toRenderer: boolean }> = []
  const draftPath = path.join(directory, 'draft.json')
  const documents = new DocumentController(
    () => ({}) as never, new FileService(), draftPath,
    (snapshot, toRenderer) => published.push({ snapshot, toRenderer }), vi.fn(), relocate,
  )
  return { documents, published, draftPath, filePath, directory }
}

describe('文档控制器', () => {
  it('保存期间继续输入的内容保持未保存，图片链接以后再改写', async () => {
    let release: (() => void) | null = null
    const { documents, filePath } = await controller(async (content) => {
      await new Promise<void>((resolve) => { release = resolve })
      return { content: content.replace('staged.png', '笔记.assets/a.png'), commit: async () => undefined }
    })
    await documents.openPath(filePath)
    const { documentId } = documents.current()
    documents.changed('![](staged.png)', documentId)
    const saving = documents.save()
    await vi.waitFor(() => expect(release).not.toBeNull())
    documents.changed('![](staged.png) 继续写', documentId)
    release!()
    expect(await saving).toEqual({ ok: true })
    expect(await readFile(filePath, 'utf8')).toBe('![](笔记.assets/a.png)')
    expect(documents.current()).toMatchObject({ content: '![](staged.png) 继续写', dirty: true })
  })

  it('来自旧文档的编辑被忽略，渲染层自己的编辑不再回传', async () => {
    const { documents, filePath, published } = await controller()
    const before = documents.current().documentId
    await documents.openPath(filePath)
    const opened = documents.current().documentId
    expect(opened).not.toBe(before)
    documents.changed('旧文档的输入', before)
    expect(documents.current()).toMatchObject({ content: '原文', dirty: false })
    documents.changed('新输入', opened)
    expect(documents.current()).toMatchObject({ content: '新输入', dirty: true })
    expect(published.at(-1)).toMatchObject({ toRenderer: false, snapshot: { content: '新输入' } })
  })

  it('选择“不保存”会删除恢复草稿；草稿只在首次启动时询问', async () => {
    const { documents, draftPath } = await controller()
    await writeFile(draftPath, JSON.stringify({ content: '崩溃前的内容', filePath: 'C:\\笔记\\周报.md' }), 'utf8')
    electron.showMessageBox.mockResolvedValueOnce({ response: 0 })
    const recovered = await documents.initialize()
    expect(recovered).toMatchObject({ content: '崩溃前的内容', recovered: true, dirty: true, filePath: null })
    expect(electron.showMessageBox.mock.calls[0][1].detail).toContain('草稿来自：C:\\笔记\\周报.md')
    await documents.whenInitialized()
    expect(await documents.initialize()).toMatchObject({ content: '崩溃前的内容' })
    expect(electron.showMessageBox).toHaveBeenCalledOnce()

    electron.showMessageBox.mockResolvedValueOnce({ response: 1 })
    expect(await documents.confirmDiscard()).toBe(true)
    await expect(stat(draftPath)).rejects.toThrow()
  })

  it('无法使用的草稿被清理，自动保存遇到外部修改时暂停', async () => {
    const { documents, draftPath, filePath } = await controller()
    await writeFile(draftPath, '{', 'utf8')
    await documents.initialize()
    await expect(stat(draftPath)).rejects.toThrow()
    expect(electron.showMessageBox).not.toHaveBeenCalled()

    await documents.openPath(filePath)
    documents.changed('本地修改', documents.current().documentId)
    const later = new Date(Date.now() + 60_000)
    await writeFile(filePath, '其他程序的修改', 'utf8')
    await utimes(filePath, later, later)
    expect(await documents.save(false, { auto: true })).toEqual({
      ok: false, conflict: true, error: '文件已在其他程序中修改，自动保存已暂停',
    })
    expect(await readFile(filePath, 'utf8')).toBe('其他程序的修改')
    documents.acknowledgeModifiedAt(later.getTime())
    expect(await documents.save(false, { auto: true })).toEqual({ ok: true })
    expect(await readFile(filePath, 'utf8')).toBe('本地修改')
  })

  it('打开失败时给出中文原因并标记文件已不存在', async () => {
    const { documents, directory } = await controller()
    const result = await documents.openPath(path.join(directory, '不存在.md'))
    expect(result).toEqual({ ok: false, error: '无法打开文件：文件不存在或已被移动', missing: true })
    expect(documents.busy()).toBe(false)
  })
})
