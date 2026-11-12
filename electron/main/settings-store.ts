import { readFile, writeFile } from 'node:fs/promises'
import type { ImageFolderMode } from '../../src/contracts'
import { isImageFolderMode } from './image-store'
import type { Bounds } from './window-state'
import { isDocumentPath } from './validators'
import { isWorkspaceRoot } from './workspace'

export interface Settings {
  bounds?: Bounds
  recentFiles: string[]
  workspaceFolder?: string
  imageFolder?: ImageFolderMode
}

export class SettingsStore {
  private value: Settings = { recentFiles: [] }

  constructor(private readonly filePath: string) {}

  async load(): Promise<Settings> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as Partial<Settings>
      this.value = {
        bounds: parsed.bounds,
        recentFiles: Array.isArray(parsed.recentFiles)
          ? parsed.recentFiles.filter(isDocumentPath).slice(0, 10)
          : [],
        workspaceFolder: isWorkspaceRoot(parsed.workspaceFolder) ? parsed.workspaceFolder : undefined,
        imageFolder: isImageFolderMode(parsed.imageFolder) ? parsed.imageFolder : undefined,
      }
    } catch {
      this.value = { recentFiles: [] }
    }
    return this.value
  }

  get(): Settings {
    return this.value
  }

  async update(update: Partial<Settings>): Promise<void> {
    this.value = { ...this.value, ...update }
    await writeFile(this.filePath, JSON.stringify(this.value, null, 2), 'utf8')
  }

  async addRecent(filePath: string): Promise<string[]> {
    if (!isDocumentPath(filePath)) return this.value.recentFiles
    const recentFiles = [filePath, ...this.value.recentFiles.filter((entry) => entry !== filePath)].slice(0, 10)
    await this.update({ recentFiles })
    return recentFiles
  }
}
