import { readFile, writeFile } from 'node:fs/promises'
import type { ImageFolderSetting, Preferences } from '../../src/contracts'
import { IMAGE_FOLDER_PRESETS } from '../../src/image-folder'
import { DEFAULT_PREFERENCES, readPreferences } from '../../src/preferences'
import type { Bounds } from './window-state'
import { isDocumentPath } from './validators'
import { isWorkspaceRoot } from './workspace'

export interface Settings {
  bounds?: Bounds
  recentFiles: string[]
  workspaceFolder?: string
  preferences: Preferences
}

/** 2.8.3 stored the image folder at the top level, first as a bare preset name. */
function legacyImageFolder(value: unknown): unknown {
  const preset = IMAGE_FOLDER_PRESETS.find(({ mode }) => mode === value)
  return preset ? { mode: preset.mode, template: preset.template } satisfies ImageFolderSetting : value
}

export class SettingsStore {
  private value: Settings = { recentFiles: [], preferences: DEFAULT_PREFERENCES }

  constructor(private readonly filePath: string) {}

  async load(): Promise<Settings> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as Partial<Settings> & { imageFolder?: unknown }
      const stored = parsed.preferences && typeof parsed.preferences === 'object' ? parsed.preferences : {}
      this.value = {
        bounds: parsed.bounds,
        recentFiles: Array.isArray(parsed.recentFiles)
          ? parsed.recentFiles.filter(isDocumentPath).slice(0, 10)
          : [],
        workspaceFolder: isWorkspaceRoot(parsed.workspaceFolder) ? parsed.workspaceFolder : undefined,
        preferences: readPreferences({ imageFolder: legacyImageFolder(parsed.imageFolder), ...stored }),
      }
    } catch {
      this.value = { recentFiles: [], preferences: DEFAULT_PREFERENCES }
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
