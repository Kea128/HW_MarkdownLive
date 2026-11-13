import { unlink, writeFile, readFile } from 'node:fs/promises'
import type { BrowserWindow } from 'electron'
import { dialog } from 'electron'
import type { DocumentSnapshot, OperationResult } from '../../src/contracts'
import { DEFAULT_TEXT_FORMAT, FileService, type TextFormat } from './file-service'
import { decisionFromDialog } from './unsaved-decision'
import { isDocumentContent, isDocumentPath } from './validators'

export type ImageRelocator = (content: string, from: string | null, to: string) =>
  Promise<{ content: string; commit(): Promise<void> }>

const keepImages: ImageRelocator = async (content) => ({ content, commit: async () => undefined })

export class DocumentController {
  private snapshot: DocumentSnapshot = {
    content: '',
    filePath: null,
    fileName: '未命名.md',
    dirty: false,
  }
  private modifiedAt = 0
  private format: TextFormat = DEFAULT_TEXT_FORMAT
  private draftTimer?: NodeJS.Timeout

  constructor(
    private readonly window: () => BrowserWindow | null,
    private readonly files: FileService,
    private readonly draftPath: string,
    private readonly onUpdated: (snapshot: DocumentSnapshot) => void,
    private readonly onRecent: (filePath: string) => void,
    private readonly relocateImages: ImageRelocator = keepImages,
  ) {}

  current(): DocumentSnapshot {
    return { ...this.snapshot }
  }

  changed(content: unknown): void {
    if (!isDocumentContent(content) || content === this.snapshot.content) return
    this.snapshot = { ...this.snapshot, content, dirty: true }
    this.publish()
    clearTimeout(this.draftTimer)
    this.draftTimer = setTimeout(() => void this.writeDraft().catch(() => undefined), 800)
  }

  async initialize(): Promise<DocumentSnapshot> {
    if (process.env.INKDOWN_E2E === '1') {
      await this.removeDraft()
      this.publish()
      return this.current()
    }
    try {
      const draft = JSON.parse(await readFile(this.draftPath, 'utf8')) as { content?: unknown }
      if (isDocumentContent(draft.content) && draft.content.length > 0) {
        const owner = this.window()
        const response = owner
          ? (await dialog.showMessageBox(owner, {
              type: 'question',
              buttons: ['恢复草稿', '丢弃'],
              defaultId: 0,
              cancelId: 1,
              title: '发现未保存草稿',
              message: 'Inkdown 检测到上次未保存的内容。',
              detail: '恢复会创建未命名文稿，不会覆盖磁盘文件。',
            })).response
          : 1
        if (response === 0) {
          this.snapshot = {
            content: draft.content,
            filePath: null,
            fileName: '恢复的草稿.md',
            dirty: true,
            recovered: true,
          }
        } else {
          await this.removeDraft()
        }
      }
    } catch {
      // Missing or invalid recovery data is intentionally ignored.
    }
    this.publish()
    return this.current()
  }

  async newDocument(): Promise<OperationResult> {
    if (!(await this.confirmDiscard())) return { ok: false, canceled: true }
    this.snapshot = { content: '', filePath: null, fileName: '未命名.md', dirty: false }
    this.format = DEFAULT_TEXT_FORMAT
    await this.removeDraft()
    this.publish()
    return { ok: true }
  }

  async openDialog(): Promise<OperationResult> {
    if (!(await this.confirmDiscard())) return { ok: false, canceled: true }
    const owner = this.window()
    if (!owner) return { ok: false, error: '窗口不可用' }
    const result = await dialog.showOpenDialog(owner, {
      properties: ['openFile'],
      filters: [{ name: 'Markdown 文档', extensions: ['md', 'markdown', 'txt'] }],
    })
    if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true }
    return this.openPath(result.filePaths[0], true)
  }

  async openPath(filePath: unknown, alreadyConfirmed = false): Promise<OperationResult> {
    if (!isDocumentPath(filePath)) return { ok: false, error: '不支持的文件路径或类型' }
    if (!alreadyConfirmed && !(await this.confirmDiscard())) return { ok: false, canceled: true }
    try {
      const loaded = await this.files.read(filePath)
      this.modifiedAt = loaded.modifiedAt
      this.format = loaded.format
      this.snapshot = {
        content: loaded.content,
        filePath,
        fileName: this.files.displayName(filePath),
        dirty: false,
      }
      await this.removeDraft()
      this.onRecent(filePath)
      this.publish()
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : '无法打开文件' }
    }
  }

  async save(saveAs = false): Promise<OperationResult> {
    let target = saveAs ? null : this.snapshot.filePath
    if (!target) {
      const owner = this.window()
      if (!owner) return { ok: false, error: '窗口不可用' }
      const result = await dialog.showSaveDialog(owner, {
        defaultPath: this.snapshot.fileName,
        filters: [{ name: 'Markdown 文档', extensions: ['md'] }],
      })
      if (result.canceled || !result.filePath) return { ok: false, canceled: true }
      target = result.filePath
    }
    try {
      const images = await this.relocateImages(this.snapshot.content, this.snapshot.filePath, target)
      this.modifiedAt = await this.files.write(target, images.content, this.format)
      this.snapshot = {
        ...this.snapshot,
        content: images.content,
        filePath: target,
        fileName: this.files.displayName(target),
        dirty: false,
        recovered: false,
      }
      await images.commit()
      await this.removeDraft()
      this.onRecent(target)
      this.publish()
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : '无法保存文件' }
    }
  }

  async confirmDiscard(): Promise<boolean> {
    if (!this.snapshot.dirty) return true
    const owner = this.window()
    if (!owner) return false
    const decision = decisionFromDialog((await dialog.showMessageBox(owner, {
      type: 'warning',
      buttons: ['保存', '不保存', '取消'],
      defaultId: 0,
      cancelId: 2,
      title: '未保存的更改',
      message: `是否保存对“${this.snapshot.fileName}”的更改？`,
      noLink: true,
    })).response)
    if (decision === 'cancel') return false
    if (decision === 'discard') return true
    return (await this.save()).ok
  }

  getKnownModifiedAt(): number {
    return this.modifiedAt
  }

  acknowledgeModifiedAt(modifiedAt: number): void {
    this.modifiedAt = modifiedAt
  }

  private publish(): void {
    this.onUpdated(this.current())
  }

  private async writeDraft(): Promise<void> {
    if (!this.snapshot.dirty) return
    await writeFile(this.draftPath, JSON.stringify({
      content: this.snapshot.content,
      savedAt: Date.now(),
    }), 'utf8')
  }

  private async removeDraft(): Promise<void> {
    clearTimeout(this.draftTimer)
    try {
      await unlink(this.draftPath)
    } catch {
      // Draft does not exist.
    }
  }
}
