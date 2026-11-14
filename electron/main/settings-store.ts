import { copyFile, readFile } from 'node:fs/promises'
import type { ImageFolderSetting, Preferences } from '../../src/contracts'
import { IMAGE_FOLDER_PRESETS } from '../../src/image-folder'
import { DEFAULT_PREFERENCES, readPreferences } from '../../src/preferences'
import { writeAtomically } from './file-service'
import type { Bounds } from './window-state'
import { isDocumentPath } from './validators'
import { isWorkspaceRoot } from './workspace'

export interface Settings {
  bounds?: Bounds
  maximized?: boolean
  zoomLevel?: number
  recentFiles: string[]
  workspaceFolder?: string
  preferences: Preferences
}

/** 2.8.3 stored the image folder at the top level, first as a bare preset name. */
function legacyImageFolder(value: unknown): unknown {
  const preset = IMAGE_FOLDER_PRESETS.find(({ mode }) => mode === value)
  return preset ? { mode: preset.mode, template: preset.template } satisfies ImageFolderSetting : value
}

const samePath = (left: string, right: string) => left.replace(/\//g, '\\').toLowerCase() === right.replace(/\//g, '\\').toLowerCase()
const isZoomLevel = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 5

export class SettingsStore {
  private value: Settings = { recentFiles: [], preferences: DEFAULT_PREFERENCES }
  private writes: Promise<void> = Promise.resolve()

  constructor(private readonly filePath: string) {}

  async load(): Promise<Settings> {
    let text: string
    try {
      text = await readFile(this.filePath, 'utf8')
    } catch {
      this.value = { recentFiles: [], preferences: DEFAULT_PREFERENCES }
      return this.value
    }
    try {
      const parsed = JSON.parse(text) as Partial<Settings> & { imageFolder?: unknown }
      const stored = parsed.preferences && typeof parsed.preferences === 'object' ? parsed.preferences : {}
      const recentFiles = Array.isArray(parsed.recentFiles) ? parsed.recentFiles.filter(isDocumentPath) : []
      this.value = {
        bounds: parsed.bounds,
        maximized: parsed.maximized === true,
        zoomLevel: isZoomLevel(parsed.zoomLevel) ? parsed.zoomLevel : undefined,
        recentFiles: recentFiles.filter((file, index) => recentFiles.findIndex((other) => samePath(other, file)) === index).slice(0, 10),
        workspaceFolder: isWorkspaceRoot(parsed.workspaceFolder) ? parsed.workspaceFolder : undefined,
        preferences: readPreferences({ imageFolder: legacyImageFolder(parsed.imageFolder), ...stored }),
      }
    } catch {
      // Keep the unreadable file for inspection instead of overwriting it with defaults on the next save.
      await copyFile(this.filePath, `${this.filePath}.broken`).catch(() => undefined)
      this.value = { recentFiles: [], preferences: DEFAULT_PREFERENCES }
    }
    return this.value
  }

  get(): Settings {
    return this.value
  }

  /** Writes run one at a time; overlapping writes could otherwise leave the tail of a longer file behind. */
  update(update: Partial<Settings>): Promise<void> {
    this.value = { ...this.value, ...update }
    const snapshot = JSON.stringify(this.value, null, 2)
    const write = this.writes.then(() => writeAtomically(this.filePath, Buffer.from(snapshot, 'utf8')))
    this.writes = write.catch(() => undefined)
    return write
  }

  /** Resolves when every queued write has reached the disk. */
  flush(): Promise<void> {
    return this.writes
  }

  async addRecent(filePath: string): Promise<string[]> {
    if (!isDocumentPath(filePath)) return this.value.recentFiles
    const recentFiles = [filePath, ...this.value.recentFiles.filter((entry) => !samePath(entry, filePath))].slice(0, 10)
    await this.update({ recentFiles })
    return recentFiles
  }

  async removeRecent(filePath: string): Promise<string[]> {
    const recentFiles = this.value.recentFiles.filter((entry) => !samePath(entry, filePath))
    if (recentFiles.length !== this.value.recentFiles.length) await this.update({ recentFiles })
    return recentFiles
  }
}
