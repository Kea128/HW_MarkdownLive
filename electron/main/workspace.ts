import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import type { WorkspaceEntry, WorkspaceSnapshot } from '../../src/contracts'

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown'])
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'bower_components', '__pycache__'])
const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })
const startsWithHan = /^\p{Script=Han}/u
// zh-CN collation puts Han before Latin; Explorer lists Latin names first and Chinese names by pinyin.
const compareNames = (left: string, right: string) =>
  Number(startsWithHan.test(left)) - Number(startsWithHan.test(right)) || collator.compare(left, right)

export interface ScanLimits {
  maxFiles: number
  maxDepth: number
}

export function isWorkspaceRoot(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 32_767 && path.isAbsolute(value)
}

export async function scanWorkspace(
  root: string,
  limits: ScanLimits = { maxFiles: 2_000, maxDepth: 8 },
): Promise<WorkspaceSnapshot> {
  if (!isWorkspaceRoot(root) || !(await stat(root)).isDirectory()) throw new Error('文件夹不存在或无法访问')
  let fileCount = 0
  let truncated = false

  const visit = async (directory: string, depth: number): Promise<WorkspaceEntry[]> => {
    let dirents
    try {
      dirents = await readdir(directory, { withFileTypes: true })
    } catch {
      return []
    }
    dirents.sort((left, right) => compareNames(left.name, right.name))
    const folders: WorkspaceEntry[] = []
    const documents: WorkspaceEntry[] = []
    for (const dirent of dirents) {
      if (dirent.name.startsWith('.') || SKIPPED_DIRECTORIES.has(dirent.name)) continue
      const entryPath = path.join(directory, dirent.name)
      if (dirent.isDirectory()) {
        if (depth >= limits.maxDepth) {
          truncated = true
          continue
        }
        const children = await visit(entryPath, depth + 1)
        if (children.length) folders.push({ name: dirent.name, path: entryPath, children })
      } else if (dirent.isFile() && MARKDOWN_EXTENSIONS.has(path.extname(dirent.name).toLowerCase())) {
        if (fileCount >= limits.maxFiles) {
          truncated = true
          continue
        }
        fileCount += 1
        documents.push({ name: dirent.name, path: entryPath })
      }
    }
    return [...folders, ...documents]
  }

  const entries = await visit(root, 0)
  return { root, name: path.basename(root) || root, entries, fileCount, truncated }
}

export function workspaceFiles(entries: WorkspaceEntry[]): string[] {
  return entries.flatMap((entry) => entry.children ? workspaceFiles(entry.children) : [entry.path])
}

export function isInsideWorkspace(root: string, filePath: string): boolean {
  const relative = path.relative(root, filePath)
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative)
}
