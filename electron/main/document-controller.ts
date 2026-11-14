import { readFile, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import type { BrowserWindow, FileFilter } from 'electron'
import { dialog } from 'electron'
import type { DocumentSnapshot, OperationResult, SaveOptions } from '../../src/contracts'
import { describeFileError, errorCode } from './file-errors'
import { DEFAULT_TEXT_FORMAT, FileService, writeAtomically, type TextFormat } from './file-service'
import { decisionFromDialog } from './unsaved-decision'
import { isDocumentContent, isDocumentPath } from './validators'

export type ImageRelocator = (content: string, from: string | null, to: string) =>
  Promise<{ content: string; commit(): Promise<void>; warning?: string }>

const keepImages: ImageRelocator = async (content) => ({ content, commit: async () => undefined })
const CANCELED: OperationResult = { ok: false, canceled: true }

interface Draft {
  content: string
  filePath: string | null
}

function documentFilters(name: string): FileFilter[] {
  const extension = path.extname(name).slice(1).toLowerCase()
  const markdown: FileFilter = { name: 'Markdown 文档', extensions: ['md', 'markdown'] }
  const text: FileFilter = { name: '文本文档', extensions: ['txt'] }
  return extension === 'txt' ? [text, markdown] : [markdown, text]
}

export class DocumentController {
  private snapshot: DocumentSnapshot = {
    documentId: 1,
    content: '',
    filePath: null,
    fileName: '未命名.md',
    dirty: false,
  }
  private nextDocumentId = 2
  private modifiedAt = 0
  private format: TextFormat = DEFAULT_TEXT_FORMAT
  private draftTimer?: NodeJS.Timeout
  private queue: Promise<unknown> = Promise.resolve()
  private pending = 0
  private initialized = false
  private resolveInitialized: () => void = () => undefined
  private readonly initializedPromise = new Promise<void>((resolve) => { this.resolveInitialized = resolve })

  constructor(
    private readonly window: () => BrowserWindow | null,
    private readonly files: FileService,
    private readonly draftPath: string,
    /** `toRenderer` is false for edits that came from the renderer, which already shows them. */
    private readonly onUpdated: (snapshot: DocumentSnapshot, toRenderer: boolean) => void,
    private readonly onRecent: (filePath: string) => void,
    private readonly relocateImages: ImageRelocator = keepImages,
  ) {}

  current(): DocumentSnapshot {
    return { ...this.snapshot }
  }

  /** True while a save, open or prompt is running. */
  busy(): boolean {
    return this.pending > 0
  }

  /** Resolves once the renderer has started and any crash draft has been offered, or after `timeout`. */
  whenInitialized(timeout = 20_000): Promise<void> {
    return Promise.race([this.initializedPromise, new Promise<void>((resolve) => setTimeout(resolve, timeout).unref())])
  }

  changed(content: unknown, documentId: unknown): void {
    if (!isDocumentContent(content) || documentId !== this.snapshot.documentId || content === this.snapshot.content) return
    this.snapshot = { ...this.snapshot, content, dirty: true }
    this.publish(false)
    clearTimeout(this.draftTimer)
    this.draftTimer = setTimeout(() => void this.writeDraft().catch(() => undefined), 800)
  }

  /** Writes the crash draft immediately, for when the renderer dies. */
  persistDraft(): Promise<void> {
    clearTimeout(this.draftTimer)
    return this.writeDraft().catch(() => undefined)
  }

  /** Offers the crash draft once per run; a reloaded renderer just receives the current document. */
  async initialize(): Promise<DocumentSnapshot> {
    if (this.initialized) {
      this.publish(false)
      return this.current()
    }
    this.initialized = true
    try {
      const draft = process.env.INKDOWN_E2E === '1' ? null : await this.readDraft()
      if (draft && await this.askToRecover(draft)) {
        this.replace({ content: draft.content, filePath: null, fileName: '恢复的草稿.md', dirty: true, recovered: true })
      } else {
        await this.removeDraft()
      }
    } finally {
      this.resolveInitialized()
    }
    this.publish(true)
    return this.current()
  }

  newDocument(): Promise<OperationResult> {
    return this.exclusive(async () => {
      if (!(await this.confirmDiscardNow())) return CANCELED
      this.format = DEFAULT_TEXT_FORMAT
      this.modifiedAt = 0
      this.replace({ content: '', filePath: null, fileName: '未命名.md', dirty: false })
      await this.removeDraft()
      this.publish(true)
      return { ok: true }
    })
  }

  openDialog(): Promise<OperationResult> {
    return this.exclusive(async () => {
      if (!(await this.confirmDiscardNow())) return CANCELED
      const owner = this.window()
      if (!owner) return { ok: false, error: '窗口不可用' }
      const result = await dialog.showOpenDialog(owner, {
        properties: ['openFile'],
        defaultPath: this.snapshot.filePath ? path.dirname(this.snapshot.filePath) : undefined,
        filters: [{ name: 'Markdown 与文本', extensions: ['md', 'markdown', 'txt'] }],
      })
      if (result.canceled || !result.filePaths[0]) return CANCELED
      return this.openNow(result.filePaths[0])
    })
  }

  openPath(filePath: unknown, alreadyConfirmed = false): Promise<OperationResult> {
    return this.exclusive(async () => {
      if (!isDocumentPath(filePath)) return { ok: false, error: '不支持的文件路径或类型' }
      if (!alreadyConfirmed && !(await this.confirmDiscardNow())) return CANCELED
      return this.openNow(filePath)
    })
  }

  save(saveAs = false, options: SaveOptions = {}): Promise<OperationResult> {
    return this.exclusive(() => this.saveNow(saveAs, options.auto === true))
  }

  confirmDiscard(): Promise<boolean> {
    return this.exclusive(() => this.confirmDiscardNow())
  }

  getKnownModifiedAt(): number {
    return this.modifiedAt
  }

  acknowledgeModifiedAt(modifiedAt: number): void {
    this.modifiedAt = Math.max(this.modifiedAt, modifiedAt)
  }

  /** Shows a message in the renderer's status bar. */
  notify(notice: string): void {
    this.publish(true, notice)
  }

  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    this.pending += 1
    const run = this.queue.then(task, task).finally(() => { this.pending -= 1 })
    this.queue = run.catch(() => undefined)
    return run
  }

  private replace(next: Omit<DocumentSnapshot, 'documentId'>): void {
    this.snapshot = { ...next, documentId: this.nextDocumentId++ }
  }

  private async openNow(filePath: string): Promise<OperationResult> {
    try {
      const loaded = await this.files.read(filePath)
      this.modifiedAt = loaded.modifiedAt
      this.format = loaded.format
      this.replace({ content: loaded.content, filePath, fileName: this.files.displayName(filePath), dirty: false })
      await this.removeDraft()
      this.onRecent(filePath)
      this.publish(true, loaded.legacy ? '此文件不是 UTF-8 编码，已按 GBK/GB18030 打开；保存时会转换为 UTF-8' : undefined)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: describeFileError(error, '打开文件'), missing: errorCode(error) === 'ENOENT' }
    }
  }

  private async saveNow(saveAs: boolean, auto: boolean): Promise<OperationResult> {
    let target = saveAs ? null : this.snapshot.filePath
    if (!target) {
      if (auto) return CANCELED
      const owner = this.window()
      if (!owner) return { ok: false, error: '窗口不可用' }
      const suggested = this.snapshot.filePath ?? this.snapshot.fileName
      const result = await dialog.showSaveDialog(owner, { defaultPath: suggested, filters: documentFilters(suggested) })
      if (result.canceled || !result.filePath) return CANCELED
      target = result.filePath
    }
    if (auto) {
      if (!this.snapshot.dirty) return { ok: true }
      const onDisk = await stat(target).then((info) => info.mtimeMs, () => null)
      if (onDisk !== null && onDisk > this.modifiedAt + 1) {
        return { ok: false, conflict: true, error: '文件已在其他程序中修改，自动保存已暂停' }
      }
    }
    try {
      const saving = this.snapshot.content
      const images = await this.relocateImages(saving, this.snapshot.filePath, target)
      this.modifiedAt = await this.files.write(target, images.content, this.format)
      // Text typed while the file was written stays unsaved, still linking the staged images it was written with.
      const editedMeanwhile = this.snapshot.content !== saving
      this.snapshot = {
        ...this.snapshot,
        content: editedMeanwhile ? this.snapshot.content : images.content,
        filePath: target,
        fileName: this.files.displayName(target),
        dirty: editedMeanwhile,
        recovered: false,
      }
      if (!editedMeanwhile) {
        await images.commit()
        await this.removeDraft()
      }
      this.onRecent(target)
      this.publish(true, images.warning)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: describeFileError(error, '保存文件') }
    }
  }

  private async confirmDiscardNow(): Promise<boolean> {
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
    if (decision === 'discard') {
      await this.removeDraft()
      return true
    }
    const saved = await this.saveNow(false, false)
    if (!saved.ok && saved.error) {
      await dialog.showMessageBox(owner, { type: 'error', title: '保存失败', message: saved.error, buttons: ['确定'], noLink: true })
    }
    return saved.ok
  }

  private async askToRecover(draft: Draft): Promise<boolean> {
    const owner = this.window()
    if (!owner) return false
    const { response } = await dialog.showMessageBox(owner, {
      type: 'question',
      buttons: ['恢复草稿', '丢弃'],
      defaultId: 0,
      cancelId: 1,
      title: '发现未保存草稿',
      message: 'Inkdown 检测到上次未保存的内容。',
      detail: [
        draft.filePath ? `草稿来自：${draft.filePath}` : '',
        '恢复会创建未命名文稿，不会覆盖磁盘文件。',
      ].filter(Boolean).join('\n'),
      noLink: true,
    })
    return response === 0
  }

  private publish(toRenderer = true, notice?: string): void {
    this.onUpdated(notice ? { ...this.current(), notice } : this.current(), toRenderer)
  }

  private async readDraft(): Promise<Draft | null> {
    try {
      const draft = JSON.parse(await readFile(this.draftPath, 'utf8')) as Partial<Draft>
      if (!isDocumentContent(draft.content) || draft.content.length === 0) return null
      return { content: draft.content, filePath: isDocumentPath(draft.filePath) ? draft.filePath : null }
    } catch {
      return null
    }
  }

  private async writeDraft(): Promise<void> {
    if (!this.snapshot.dirty) return
    await writeAtomically(this.draftPath, Buffer.from(JSON.stringify({
      content: this.snapshot.content,
      filePath: this.snapshot.filePath,
      savedAt: Date.now(),
    }), 'utf8'))
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
