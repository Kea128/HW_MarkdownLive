import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SettingsStore } from '../electron/main/settings-store'
import { isInsideWorkspace, isWorkspaceRoot, scanWorkspace, workspaceFiles } from '../electron/main/workspace'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })))
})

async function createTree(files: string[]): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), '文件夹-'))
  temporaryDirectories.push(root)
  for (const file of files) {
    const target = path.join(root, file)
    if (file.endsWith('/')) {
      await mkdir(target, { recursive: true })
      continue
    }
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, '# 标题', 'utf8')
  }
  return root
}

describe('文件夹工作区', () => {
  it('只列出 Markdown 文件，跳过隐藏目录、依赖目录与空目录，并按自然顺序排列', async () => {
    const root = await createTree([
      '第10章.md', '第2章.md', 'README.markdown', 'notes.txt', 'image.png',
      '.git/HEAD.md', 'node_modules/pkg/readme.md', '空目录/', '附件/说明.txt',
      '指南/安装.md', '指南/进阶/配置.MD',
    ])
    const snapshot = await scanWorkspace(root)
    expect(snapshot.root).toBe(root)
    expect(snapshot.name).toBe(path.basename(root))
    expect(snapshot.fileCount).toBe(5)
    expect(snapshot.truncated).toBe(false)
    expect(snapshot.entries.map((entry) => entry.name)).toEqual(['指南', 'README.markdown', '第2章.md', '第10章.md'])
    const guide = snapshot.entries[0]
    expect(guide.children?.map((entry) => entry.name)).toEqual(['进阶', '安装.md'])
    expect(guide.children?.[0].children?.[0].path).toBe(path.join(root, '指南', '进阶', '配置.MD'))
    expect(workspaceFiles(snapshot.entries)).toHaveLength(5)
  })

  it('超过文件数量或目录深度上限时截断并标记', async () => {
    const root = await createTree(['a.md', 'b.md', 'c.md', '一/二/三/深.md'])
    const byCount = await scanWorkspace(root, { maxFiles: 2, maxDepth: 8 })
    expect(byCount.fileCount).toBe(2)
    expect(byCount.truncated).toBe(true)
    const byDepth = await scanWorkspace(root, { maxFiles: 100, maxDepth: 1 })
    expect(workspaceFiles(byDepth.entries)).not.toContain(path.join(root, '一', '二', '三', '深.md'))
    expect(byDepth.truncated).toBe(true)
  })

  it('拒绝不存在或非绝对路径的文件夹', async () => {
    await expect(scanWorkspace('relative/folder')).rejects.toThrow('文件夹不存在或无法访问')
    await expect(scanWorkspace(path.join(tmpdir(), 'inkdown-missing-folder'))).rejects.toThrow()
    expect(isWorkspaceRoot(tmpdir())).toBe(true)
    expect(isWorkspaceRoot('docs')).toBe(false)
  })

  it('判断文件是否位于工作区内', () => {
    const root = path.resolve('工作区')
    expect(isInsideWorkspace(root, path.join(root, '子目录', '文档.md'))).toBe(true)
    expect(isInsideWorkspace(root, root)).toBe(false)
    expect(isInsideWorkspace(root, path.resolve('工作区-其他', '文档.md'))).toBe(false)
    expect(isInsideWorkspace(root, path.resolve('外部.md'))).toBe(false)
  })

  it('在设置中持久化并校验工作区文件夹', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), '设置-'))
    temporaryDirectories.push(directory)
    const settingsPath = path.join(directory, 'settings.json')
    const store = new SettingsStore(settingsPath)
    await store.load()
    await store.update({ workspaceFolder: directory })
    expect((await new SettingsStore(settingsPath).load()).workspaceFolder).toBe(directory)
    await writeFile(settingsPath, JSON.stringify({ recentFiles: [], workspaceFolder: 'relative' }), 'utf8')
    expect((await new SettingsStore(settingsPath).load()).workspaceFolder).toBeUndefined()
  })
})
