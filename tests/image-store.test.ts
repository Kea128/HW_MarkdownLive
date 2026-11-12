import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  imageFolder, imageTimestamp, isImageFolderMode, relocateImages, removeStagedImages, sanitizeFileName, saveImage,
} from '../electron/main/image-store'
import { SettingsStore } from '../electron/main/settings-store'

const directories: string[] = []
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const now = new Date(2026, 10, 12, 17, 4, 5, 123)

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function workspace() {
  const root = await mkdtemp(path.join(tmpdir(), '图片-'))
  directories.push(root)
  const notes = path.join(root, '笔记')
  await mkdir(notes, { recursive: true })
  return { root, notes, document: path.join(notes, '周报 1.md'), staging: path.join(root, 'staging') }
}

describe('图片文件夹与命名', () => {
  it('按设置生成文档同名 .assets、同名文件夹或共享 assets 文件夹', () => {
    const document = path.resolve('笔记', '周报.md')
    expect(imageFolder(document, 'document-assets')).toBe(path.resolve('笔记', '周报.assets'))
    expect(imageFolder(document, 'document-name')).toBe(path.resolve('笔记', '周报'))
    expect(imageFolder(document, 'shared-assets')).toBe(path.resolve('笔记', 'assets'))
    expect(isImageFolderMode('document-assets')).toBe(true)
    expect(isImageFolderMode('desktop')).toBe(false)
  })

  it('使用与 Typora 相同的时间戳文件名并清理非法字符', () => {
    expect(imageTimestamp(now)).toBe('image-20261112170405123')
    expect(sanitizeFileName('a<b>:c"d/e\\f|g?h*  . ')).toBe('abcdefgh')
    expect(sanitizeFileName('x'.repeat(100))).toHaveLength(80)
  })
})

describe('保存粘贴与拖入的图片', () => {
  it('剪贴板图片写入文档同名 .assets 文件夹，重名时自动编号', async () => {
    const { notes, document, staging } = await workspace()
    const options = { documentPath: document, stagingDir: staging, mode: 'document-assets' as const, now }
    const first = await saveImage({ name: 'image.png', type: 'image/png', data: png }, options)
    const second = await saveImage({ name: 'image.png', type: 'image/png', data: png }, options)
    expect(first).toEqual({ ok: true, src: '周报 1.assets/image-20261112170405123.png', location: 'saved' })
    expect(second).toEqual({ ok: true, src: '周报 1.assets/image-20261112170405123-1.png', location: 'saved' })
    expect(await readFile(path.join(notes, '周报 1.assets', 'image-20261112170405123.png'))).toEqual(Buffer.from(png))
    const named = await saveImage({ name: '架构图.jpeg', type: 'image/jpeg', data: png }, { ...options, mode: 'document-name' })
    expect(named).toMatchObject({ ok: true, src: '周报 1/架构图.jpg' })
  })

  it('文档文件夹内的图片直接引用，外部图片复制进图片文件夹', async () => {
    const { root, notes, document, staging } = await workspace()
    const options = { documentPath: document, stagingDir: staging, mode: 'document-assets' as const, now }
    await mkdir(path.join(notes, 'img'), { recursive: true })
    await writeFile(path.join(notes, 'img', '已有.png'), png)
    expect(await saveImage({ name: '已有.png', type: 'image/png', sourcePath: path.join(notes, 'img', '已有.png') }, options))
      .toEqual({ ok: true, src: 'img/已有.png', location: 'linked' })
    await writeFile(path.join(root, '外部 图片.PNG'), png)
    expect(await saveImage({ name: '外部 图片.PNG', type: '', sourcePath: path.join(root, '外部 图片.PNG') }, options))
      .toEqual({ ok: true, src: '周报 1.assets/外部 图片.png', location: 'saved' })
    expect(await readdir(path.join(notes, '周报 1.assets'))).toEqual(['外部 图片.png'])
  })

  it('未保存的文档先把图片暂存起来，并返回绝对路径', async () => {
    const { staging } = await workspace()
    const result = await saveImage({ name: 'image.png', type: 'image/png', data: png }, {
      documentPath: null, stagingDir: staging, mode: 'document-assets', now,
    })
    expect(result).toEqual({
      ok: true, src: `${staging.split(path.sep).join('/')}/image-20261112170405123.png`, location: 'staged',
    })
  })

  it('拒绝非图片、空数据和不存在的文件', async () => {
    const { root, document, staging } = await workspace()
    const options = { documentPath: document, stagingDir: staging, mode: 'document-assets' as const }
    expect(await saveImage(null, options)).toEqual({ ok: false, error: '图片数据无效' })
    expect(await saveImage({ name: 'a.exe', type: 'application/x-msdownload', data: png }, options))
      .toEqual({ ok: false, error: '不支持的图片格式' })
    expect(await saveImage({ name: 'a.png', type: 'image/png', data: new Uint8Array() }, options))
      .toMatchObject({ ok: false, error: expect.stringContaining('图片数据为空') })
    expect(await saveImage({ name: 'a.txt', type: '', sourcePath: path.join(root, 'a.txt') }, options))
      .toEqual({ ok: false, error: '只能插入图片文件' })
    expect(await saveImage({ name: 'b.png', type: '', sourcePath: path.join(root, 'missing.png') }, options))
      .toMatchObject({ ok: false, error: expect.stringContaining('不存在') })
  })
})

describe('保存文档时整理图片', () => {
  it('首次保存时把暂存图片移入图片文件夹并改写链接', async () => {
    const { notes, document, staging } = await workspace()
    await mkdir(staging, { recursive: true })
    await writeFile(path.join(staging, 'image-1.png'), png)
    const stagedLink = `${staging.split(path.sep).join('/')}/image-1.png`
    const content = `# 草稿\n\n![image-1](<${stagedLink}>)\n\n<img src="${stagedLink}" style="zoom:50%">\n\n![远程](https://example.com/a.png)`
    const result = await relocateImages(content, { from: null, to: document, stagingDir: staging, mode: 'document-assets' })
    expect(result.content).toBe('# 草稿\n\n![image-1](<周报 1.assets/image-1.png>)\n\n<img src="周报 1.assets/image-1.png" style="zoom:50%">'
      + '\n\n![远程](https://example.com/a.png)')
    expect(result.staged).toEqual([path.join(staging, 'image-1.png')])
    expect(await readdir(path.join(notes, '周报 1.assets'))).toEqual(['image-1.png'])
    await removeStagedImages(result.staged)
    expect(await readdir(staging)).toEqual([])
  })

  it('另存到其他文件夹时复制失效的相对图片，同文件夹另存不改动', async () => {
    const { root, notes, document, staging } = await workspace()
    await mkdir(path.join(notes, '周报 1.assets'), { recursive: true })
    await writeFile(path.join(notes, '周报 1.assets', 'a.png'), png)
    const content = '![a](<周报 1.assets/a.png>)\n![缺失](missing.png)\n![绝对](C:/不存在/b.png)'
    const sameFolder = await relocateImages(content, {
      from: document, to: path.join(notes, '改名.md'), stagingDir: staging, mode: 'document-assets',
    })
    expect(sameFolder.content).toBe(content)
    const target = path.join(root, '归档', '周报.md')
    const moved = await relocateImages(content, { from: document, to: target, stagingDir: staging, mode: 'document-assets' })
    expect(moved.content).toBe('![a](周报.assets/a.png)\n![缺失](missing.png)\n![绝对](C:/不存在/b.png)')
    expect(moved.staged).toEqual([])
    expect(await readdir(path.join(root, '归档', '周报.assets'))).toEqual(['a.png'])
    expect(await readdir(path.join(notes, '周报 1.assets'))).toEqual(['a.png'])
  })

  it('在设置中保存并校验图片保存位置', async () => {
    const { root } = await workspace()
    const file = path.join(root, 'settings.json')
    const store = new SettingsStore(file)
    await store.load()
    await store.update({ imageFolder: 'shared-assets' })
    expect((await new SettingsStore(file).load()).imageFolder).toBe('shared-assets')
    await writeFile(file, JSON.stringify({ recentFiles: [], imageFolder: 'desktop' }), 'utf8')
    expect((await new SettingsStore(file).load()).imageFolder).toBeUndefined()
  })
})
