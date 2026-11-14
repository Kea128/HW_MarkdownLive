import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ dialog: { showMessageBox: vi.fn(), showOpenDialog: vi.fn(), showSaveDialog: vi.fn() } }))

import { DocumentController, type ImageRelocator } from '../electron/main/document-controller'
import type { FileService } from '../electron/main/file-service'
import type { DocumentSnapshot } from '../src/contracts'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function controller(relocate: ImageRelocator) {
  const directory = await mkdtemp(path.join(tmpdir(), '文档-'))
  directories.push(directory)
  const written: string[] = []
  const files = {
    read: vi.fn(async () => ({ content: '原文', modifiedAt: 1, format: { eol: '\n', bom: false } })),
    write: vi.fn(async (_target: string, content: string) => {
      written.push(content)
      return 2
    }),
    displayName: (filePath: string) => path.basename(filePath),
  } as unknown as FileService
  const published: DocumentSnapshot[] = []
  const documents = new DocumentController(
    () => null, files, path.join(directory, 'draft.json'), (snapshot) => published.push(snapshot), vi.fn(), relocate,
  )
  await documents.openPath(path.join(directory, '笔记.md'))
  return { documents, written, published }
}

describe('文档保存', () => {
  it('保存期间继续输入的内容保持未保存，暂存图片要等下一次保存再清理', async () => {
    let release: (() => void) | null = null
    const commit = vi.fn(async () => undefined)
    const { documents, written } = await controller(async (content) => {
      await new Promise<void>((resolve) => { release = resolve })
      return { content: content.replace('staged.png', '笔记.assets/a.png'), commit }
    })
    documents.changed('![](staged.png)')
    const saving = documents.save()
    await vi.waitFor(() => expect(release).not.toBeNull())
    documents.changed('![](staged.png) 继续写')
    release!()
    expect(await saving).toEqual({ ok: true })
    expect(written).toEqual(['![](笔记.assets/a.png)'])
    expect(documents.current()).toMatchObject({ content: '![](staged.png) 继续写', dirty: true })
    expect(commit).not.toHaveBeenCalled()

    release = null
    const again = documents.save()
    await vi.waitFor(() => expect(release).not.toBeNull())
    release!()
    expect(await again).toEqual({ ok: true })
    expect(documents.current()).toMatchObject({ content: '![](笔记.assets/a.png) 继续写', dirty: false })
    expect(commit).toHaveBeenCalledOnce()
  })
})
