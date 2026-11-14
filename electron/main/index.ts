import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, stat } from 'node:fs/promises'
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  screen,
  shell,
  type MenuItemConstructorOptions,
  type MessageBoxOptions,
  type OpenDialogOptions,
} from 'electron'
import {
  IPC, type FeedbackResult, type ImageSaveResult, type Preferences, type PreferencesResult, type Theme, type UpdateState,
  type ViewMode, type WorkspaceSnapshot,
} from '../../src/contracts'
import { IMAGE_FOLDER_PRESETS } from '../../src/image-folder'
import { fromImageUrl, resolveImageSource, uncHost } from '../../src/image-source'
import { createFeedbackRecord, feedbackIssueUrl, formatFeedback, validateFeedback } from '../../src/feedback'
import { mergePreferences } from '../../src/preferences'
import { contextMenuTemplate } from './context-menu'
import { DocumentController } from './document-controller'
import { appendFeedback } from './feedback-store'
import { describeFileError } from './file-errors'
import { FileService } from './file-service'
import { registerImageScheme, serveLocalImages } from './image-protocol'
import { cleanStagedImages, relocateImages, saveImage } from './image-store'
import { SettingsStore } from './settings-store'
import { UpdateController } from './update-controller'
import { detectInstallKind, RELEASES_URL, REPOSITORY_URL, type InstallKind } from './update-policy'
import { isDocumentContent, isDocumentPath, isSafeExternalUrl } from './validators'
import { restoreBounds } from './window-state'
import { isInsideWorkspace, scanWorkspace, workspaceFiles } from './workspace'

let mainWindow: BrowserWindow | null = null
let documents: DocumentController
let updates: UpdateController
let settings: SettingsStore
let installKind: InstallKind = 'development'
let workspace: WorkspaceSnapshot | null = null
let workspaceTask: Promise<unknown> = Promise.resolve()
let workspaceScannedAt = 0
let quitting = false
let externalPromptActive = false
let externalChangeTimer: NodeJS.Timeout | undefined
let documentsReady = false
let pendingDocumentPath: string | null = null
let closing: Promise<void> | null = null
let closeAnswered = true
let rendererCrashes: number[] = []
let missingNoticePath: string | null = null

const send = (channel: string, ...args: unknown[]) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args)
}

const trustedEvent = (senderId: number) => mainWindow?.webContents.id === senderId
const preferences = () => settings.get().preferences

function applyPreferences(next: Preferences, previous?: Preferences): void {
  nativeTheme.themeSource = next.theme
  if (previous && previous.theme !== next.theme) send(IPC.themeChanged, next.theme)
  mainWindow?.webContents.session.setSpellCheckerEnabled(next.spellcheck)
  buildMenu()
}

async function updatePreferences(patch: unknown): Promise<PreferencesResult> {
  const previous = preferences()
  const result = mergePreferences(previous, patch)
  if (!result.ok) return result
  await settings.update({ preferences: result.value })
  applyPreferences(result.value, previous)
  send(IPC.settingsChanged, result.value)
  return result
}

const setAppTheme = (theme: Theme) => updatePreferences({ theme }).then(() => preferences().theme)
const showMessage = (options: MessageBoxOptions) =>
  mainWindow ? dialog.showMessageBox(mainWindow, options) : dialog.showMessageBox(options)
const updateMenuLabels: Record<UpdateState['phase'], string> = {
  idle: '检查更新…',
  checking: '正在检查更新…',
  downloading: '取消下载更新',
  downloaded: '重启并安装更新…',
}
const installKindLabels: Record<InstallKind, string> = {
  installed: '安装版',
  portable: '便携版',
  archive: 'ZIP 版',
  development: '开发版',
}
const feedbackFile = () => path.join(app.getPath('userData'), 'feedback', 'feedback.jsonl')
const stagedImages = () => path.join(app.getPath('userData'), 'pasted-images')
const imageSetting = () => preferences().imageFolder
const recoveryDraft = () => path.join(app.getPath('userData'), 'recovery-draft.json')
const imageOptions = () => ({ documentPath: documents.current().filePath, stagingDir: stagedImages(), folder: imageSetting() })
/**
 * Reading `\\server\share\…` makes Windows sign in to that server, so a document from the internet could collect
 * the user's NTLM hash just by being opened. Network images load only from the server the document itself is on.
 */
const imageAllowed = (filePath: string) => {
  const host = uncHost(filePath)
  return host === null || host === uncHost(documents.current().filePath)
}
const localImage = (src: unknown) => {
  if (typeof src !== 'string') return null
  const filePath = fromImageUrl(resolveImageSource(src, documents.current().filePath))
  return filePath && imageAllowed(filePath) && existsSync(filePath) ? filePath : null
}

async function chooseImages(): Promise<ImageSaveResult[]> {
  const options: OpenDialogOptions = {
    title: '插入图片',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'ico'] }],
  }
  const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options)
  if (result.canceled) return []
  return Promise.all(result.filePaths.map((sourcePath) =>
    saveImage({ name: path.basename(sourcePath), type: '', sourcePath }, imageOptions())))
}

function serializeWorkspace<T>(task: () => Promise<T>): Promise<T> {
  const run = workspaceTask.then(task, task)
  workspaceTask = run.catch(() => undefined)
  return run
}

function applyWorkspace(snapshot: WorkspaceSnapshot | null): WorkspaceSnapshot | null {
  const rootChanged = snapshot?.root !== workspace?.root
  const changed = JSON.stringify(snapshot) !== JSON.stringify(workspace)
  workspace = snapshot
  if (changed) send(IPC.workspaceUpdated, snapshot)
  if (rootChanged) buildMenu()
  return snapshot
}

const openWorkspace = (root: string) => serializeWorkspace(async () => {
  const snapshot = await scanWorkspace(root)
  workspaceScannedAt = Date.now()
  await settings.update({ workspaceFolder: snapshot.root })
  return applyWorkspace(snapshot)
})

const closeWorkspace = () => serializeWorkspace(async () => {
  await settings.update({ workspaceFolder: undefined })
  applyWorkspace(null)
  return null
})

let workspaceRefresh: Promise<WorkspaceSnapshot | null> | null = null
const refreshWorkspace = () => workspaceRefresh ??= serializeWorkspace(async () => {
  const root = workspace?.root ?? settings.get().workspaceFolder
  if (!root) return null
  try {
    return applyWorkspace(await scanWorkspace(root))
  } catch {
    // A share that is briefly unreachable keeps its tree; a folder that is gone is closed.
    return applyWorkspace(await stat(root).then(() => workspace, () => null))
  } finally {
    workspaceScannedAt = Date.now()
  }
}).finally(() => { workspaceRefresh = null })

async function chooseWorkspace(): Promise<WorkspaceSnapshot | null> {
  const options: OpenDialogOptions = { title: '打开文件夹', properties: ['openDirectory'], defaultPath: workspace?.root }
  const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options)
  const [root] = result.filePaths
  if (result.canceled || !root) return workspace
  try {
    return await openWorkspace(root)
  } catch (error) {
    void showMessage({
      type: 'error',
      title: '无法打开文件夹',
      message: describeFileError(error, '读取所选文件夹'),
    })
    return workspace
  }
}

function syncWorkspaceWith(filePath: string): void {
  if (workspace && isInsideWorkspace(workspace.root, filePath) && !workspaceFiles(workspace.entries).includes(filePath)) {
    void refreshWorkspace()
  }
}

async function submitFeedback(input: unknown, channel: unknown): Promise<FeedbackResult> {
  if (channel !== 'github' && channel !== 'copy') return { ok: false, error: '无效的提交方式' }
  const validated = validateFeedback(input)
  if (!validated.ok) return validated
  const record = createFeedbackRecord(validated.value, {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    channel,
    environment: {
      app: `${app.getVersion()}（${installKindLabels[installKind]}）`,
      electron: process.versions.electron,
      os: `${os.version()} ${os.release()} ${process.arch}`,
      locale: app.getLocale(),
    },
  })
  await appendFeedback(feedbackFile(), record).catch(() => undefined)
  const markdown = formatFeedback(record)
  if (channel === 'copy') {
    clipboard.writeText(markdown)
    return { ok: true, id: record.id, tags: record.tags, truncated: false }
  }
  const { url, truncated } = feedbackIssueUrl(record, REPOSITORY_URL)
  if (truncated) clipboard.writeText(markdown)
  try {
    await shell.openExternal(url)
  } catch {
    clipboard.writeText(markdown)
    return { ok: false, error: '无法打开浏览器，反馈内容已复制到剪贴板。' }
  }
  return { ok: true, id: record.id, tags: record.tags, truncated }
}

async function createWindow(): Promise<void> {
  serveLocalImages(imageAllowed)
  settings = new SettingsStore(path.join(app.getPath('userData'), 'settings.json'))
  await settings.load()
  nativeTheme.themeSource = preferences().theme
  const primary = screen.getPrimaryDisplay()
  const displays = [primary, ...screen.getAllDisplays().filter(({ id }) => id !== primary.id)].map(({ workArea }) => workArea)
  const bounds = restoreBounds(settings.get().bounds, displays)

  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 800,
    minHeight: 560,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1d2025' : '#f7f7f5',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })

  mainWindow.webContents.session.setSpellCheckerEnabled(preferences().spellcheck)

  documents = new DocumentController(
    () => mainWindow,
    new FileService(),
    recoveryDraft(),
    (snapshot, toRenderer) => {
      if (toRenderer) send(IPC.documentUpdated, snapshot)
      if (mainWindow) mainWindow.setTitle(`${snapshot.dirty ? '*' : ''}${snapshot.fileName} — Inkdown`)
    },
    (filePath) => {
      void settings.addRecent(filePath).then(() => buildMenu(), () => undefined)
      syncWorkspaceWith(filePath)
    },
    async (content, from, to) => {
      const images = await relocateImages(content, { from, to, stagingDir: stagedImages(), folder: imageSetting() })
      return {
        content: images.content,
        commit: async () => undefined,
        warning: images.failed ? `有 ${images.failed} 张图片未能复制到图片文件夹，仍使用原来的路径` : undefined,
      }
    },
  )
  documentsReady = true
  installKind = detectInstallKind({
    isPackaged: app.isPackaged,
    execPath: process.execPath,
    env: process.env,
    exists: existsSync,
  })
  updates = new UpdateController({
    loadUpdater: async () => {
      const { autoUpdater, CancellationToken } = await import('electron-updater')
      return { updater: autoUpdater, createCancellationToken: () => new CancellationToken() }
    },
    kind: installKind,
    currentVersion: app.getVersion(),
    showMessageBox: showMessage,
    openExternal: (url) => shell.openExternal(url),
    confirmQuit: () => documents.confirmDiscard(),
    onState: (state, previous) => {
      send(IPC.updateState, state)
      mainWindow?.setProgressBar(state.phase === 'downloading' ? state.percent / 100 : -1)
      if (state.phase !== previous.phase) buildMenu()
    },
  })

  registerIpc()
  buildMenu()
  secureWindow(mainWindow)

  const window = mainWindow
  window.once('ready-to-show', () => {
    if (settings.get().maximized) window.maximize()
    window.show()
  })
  window.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    requestClose()
  })
  window.on('closed', () => {
    clearInterval(externalChangeTimer)
    externalChangeTimer = undefined
    mainWindow = null
  })
  let boundsTimer: NodeJS.Timeout | undefined
  const persistBounds = () => {
    clearTimeout(boundsTimer)
    boundsTimer = setTimeout(() => {
      if (window.isDestroyed() || window.isMinimized()) return
      void settings.update({ bounds: window.getNormalBounds(), maximized: window.isMaximized() }).catch(() => undefined)
    }, 300)
  }
  window.on('resize', persistBounds)
  window.on('move', persistBounds)
  window.on('maximize', persistBounds)
  window.on('unmaximize', persistBounds)
  window.on('focus', () => {
    if (workspace && Date.now() - workspaceScannedAt > 2_000) void refreshWorkspace()
  })
  window.webContents.on('did-finish-load', () => {
    window.webContents.setZoomLevel(settings.get().zoomLevel ?? 0)
  })
  window.webContents.on('zoom-changed', (_event, direction) => zoom(direction === 'in' ? 1 : -1))
  window.webContents.on('render-process-gone', (_event, details) => void recoverRenderer(details.reason))

  // The development server is only trusted in an unpacked build; an installed copy always loads its own files.
  const devUrl = app.isPackaged ? undefined : process.env.VITE_DEV_SERVER_URL
  try {
    if (devUrl && /^http:\/\/(127\.0\.0\.1|localhost):\d+\/?$/.test(devUrl)) await window.loadURL(devUrl)
    else await window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  } catch (error) {
    dialog.showErrorBox('Inkdown 无法启动', error instanceof Error ? error.message : String(error))
    quitting = true
    app.quit()
    return
  }
  startExternalChangeMonitor()
}

/** The renderer answers with the save prompt; if it has crashed or hangs, the main process asks instead. */
function requestClose(): void {
  if (closing) return
  closeAnswered = false
  send(IPC.documentCommand, { action: 'close' })
  setTimeout(() => {
    if (closeAnswered || quitting || !mainWindow || mainWindow.isDestroyed()) return
    void closeDocuments()
  }, 4_000).unref()
}

function closeDocuments(): Promise<void> {
  closing ??= documents.confirmDiscard().then(async (confirmed) => {
    if (!confirmed) return
    quitting = true
    await settings.flush()
    app.quit()
  }).finally(() => { closing = null })
  return closing
}

async function recoverRenderer(reason: string): Promise<void> {
  if (reason === 'clean-exit' || !mainWindow || mainWindow.isDestroyed()) return
  await documents.persistDraft()
  const now = Date.now()
  rendererCrashes = [...rendererCrashes.filter((time) => now - time < 60_000), now]
  if (rendererCrashes.length <= 2) {
    mainWindow.reload()
    return
  }
  const { response } = await showMessage({
    type: 'error',
    title: '编辑器反复崩溃',
    message: '编辑器页面多次意外退出。',
    detail: '未保存的内容已写入恢复草稿，下次启动时可以恢复。',
    buttons: ['重新加载', '退出'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  })
  if (response === 0 && mainWindow && !mainWindow.isDestroyed()) mainWindow.reload()
  else {
    quitting = true
    app.quit()
  }
}

function zoom(step: number): void {
  const contents = mainWindow?.webContents
  if (!contents) return
  const level = step === 0 ? 0 : Math.max(-3, Math.min(5, contents.getZoomLevel() + step * 0.5))
  contents.setZoomLevel(level)
  void settings.update({ zoomLevel: level }).catch(() => undefined)
}

function secureWindow(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.on('context-menu', (_event, params) => {
    const items = contextMenuTemplate(params, {
      replaceMisspelling: (word) => window.webContents.replaceMisspelling(word),
      addToDictionary: (word) => window.webContents.session.addWordToSpellCheckerDictionary(word),
    })
    if (items.length) Menu.buildFromTemplate(items).popup({ window })
  })
  // Only clipboard writes (the code block copy button) are needed; camera, location, notifications and the rest stay off.
  const allowed = (permission: string) => permission === 'clipboard-sanitized-write'
  window.webContents.session.setPermissionRequestHandler((_contents, permission, callback) => callback(allowed(permission)))
  window.webContents.session.setPermissionCheckHandler((_contents, permission) => allowed(permission))
  const connect = app.isPackaged ? "'self'" : "'self' http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*"
  window.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: http: inkdown-image:; font-src 'self'; connect-src ${connect}; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'`,
        ],
      },
    })
  })
}

function registerIpc(): void {
  ipcMain.handle(IPC.documentInit, (event) => trustedEvent(event.sender.id) ? documents.initialize() : null)
  ipcMain.handle(IPC.documentNew, (event) => trustedEvent(event.sender.id) ? documents.newDocument() : { ok: false })
  ipcMain.handle(IPC.documentOpen, (event) => trustedEvent(event.sender.id) ? documents.openDialog() : { ok: false })
  ipcMain.handle(IPC.documentOpenPath, (event, filePath) =>
    trustedEvent(event.sender.id) && isDocumentPath(filePath)
      ? openDocument(filePath)
      : { ok: false, error: '无效文件路径' })
  ipcMain.handle(IPC.documentSave, (event, options) => trustedEvent(event.sender.id)
    ? documents.save(false, { auto: (options as { auto?: unknown } | null)?.auto === true })
    : { ok: false })
  ipcMain.handle(IPC.documentSaveAs, (event) => trustedEvent(event.sender.id) ? documents.save(true) : { ok: false })
  ipcMain.handle(IPC.documentClose, async (event) => {
    if (!trustedEvent(event.sender.id)) return { ok: false, canceled: true }
    closeAnswered = true
    await closeDocuments()
    return quitting ? { ok: true } : { ok: false, canceled: true }
  })
  ipcMain.handle(IPC.documentChanged, (event, content, documentId) => {
    if (trustedEvent(event.sender.id) && isDocumentContent(content)) documents.changed(content, documentId)
  })
  ipcMain.handle(IPC.themeSet, (event, theme) =>
    trustedEvent(event.sender.id) ? setAppTheme(theme) : nativeTheme.themeSource)
  ipcMain.handle(IPC.externalOpen, (event, url) => {
    if (!trustedEvent(event.sender.id) || !isSafeExternalUrl(url)) return false
    return shell.openExternal(url).then(() => true, () => false)
  })
  ipcMain.handle(IPC.workspaceGet, (event) => trustedEvent(event.sender.id) ? workspace ?? refreshWorkspace() : null)
  ipcMain.handle(IPC.workspaceOpen, (event) => trustedEvent(event.sender.id) ? chooseWorkspace() : null)
  ipcMain.handle(IPC.workspaceRefresh, (event) => trustedEvent(event.sender.id) ? refreshWorkspace() : null)
  ipcMain.handle(IPC.workspaceClose, (event) => trustedEvent(event.sender.id) ? closeWorkspace() : null)
  ipcMain.handle(IPC.imageSave, (event, input) =>
    trustedEvent(event.sender.id) ? saveImage(input, imageOptions()) : { ok: false, error: '请求无效' })
  ipcMain.handle(IPC.imageChoose, (event) => trustedEvent(event.sender.id) ? chooseImages() : [])
  ipcMain.handle(IPC.imageOpen, async (event, src) => {
    const filePath = trustedEvent(event.sender.id) ? localImage(src) : null
    return filePath ? (await shell.openPath(filePath)) === '' : false
  })
  ipcMain.handle(IPC.imageReveal, (event, src) => {
    const filePath = trustedEvent(event.sender.id) ? localImage(src) : null
    if (filePath) shell.showItemInFolder(filePath)
    return Boolean(filePath)
  })
  ipcMain.handle(IPC.imageCopy, (event, src) => {
    const filePath = trustedEvent(event.sender.id) ? localImage(src) : null
    const image = filePath ? nativeImage.createFromPath(filePath) : null
    if (!image || image.isEmpty()) return false
    clipboard.writeImage(image)
    return true
  })
  ipcMain.handle(IPC.settingsGet, (event) => trustedEvent(event.sender.id) ? preferences() : null)
  ipcMain.handle(IPC.settingsSet, (event, patch) =>
    trustedEvent(event.sender.id) ? updatePreferences(patch) : { ok: false, error: '请求无效' })
  ipcMain.handle(IPC.feedbackSubmit, (event, input, channel) =>
    trustedEvent(event.sender.id) ? submitFeedback(input, channel) : { ok: false, error: '请求无效' })
  ipcMain.handle(IPC.feedbackOpenFolder, async (event) => {
    if (!trustedEvent(event.sender.id)) return
    const directory = path.dirname(feedbackFile())
    await mkdir(directory, { recursive: true })
    await shell.openPath(directory)
  })
}

function buildMenu(): void {
  const view = (label: string, accelerator: string, mode: ViewMode): MenuItemConstructorOptions => ({
    label,
    accelerator,
    click: () => send(IPC.viewMode, mode),
  })
  const theme = (label: string, value: Theme): MenuItemConstructorOptions => ({
    label,
    type: 'radio',
    checked: preferences().theme === value,
    click: () => void setAppTheme(value),
  })
  const updatePhase = updates.state().phase
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: '文件(&F)',
      submenu: [
        { label: '新建', accelerator: 'Ctrl+N', click: () => send(IPC.documentCommand, { action: 'new' }) },
        { label: '打开…', accelerator: 'Ctrl+O', click: () => send(IPC.documentCommand, { action: 'open' }) },
        { label: '打开文件夹…', accelerator: 'Ctrl+Shift+O', click: () => void chooseWorkspace() },
        { label: '关闭文件夹', enabled: Boolean(workspace), click: () => void closeWorkspace() },
        {
          label: '最近文件',
          submenu: settings.get().recentFiles.length
            ? settings.get().recentFiles.map((filePath) => ({
                label: filePath,
                click: () => send(IPC.documentCommand, { action: 'openPath', filePath }),
              }))
            : [{ label: '暂无', enabled: false }],
        },
        { type: 'separator' },
        { label: '保存', accelerator: 'Ctrl+S', click: () => send(IPC.documentCommand, { action: 'save' }) },
        { label: '另存为…', accelerator: 'Ctrl+Shift+S', click: () => send(IPC.documentCommand, { action: 'saveAs' }) },
        { type: 'separator' },
        {
          label: '图片保存位置',
          submenu: [
            ...IMAGE_FOLDER_PRESETS.map(({ mode, template, label }): MenuItemConstructorOptions => ({
              label,
              type: 'radio',
              checked: imageSetting().mode === mode,
              click: () => void updatePreferences({ imageFolder: { mode, template } }),
            })),
            {
              label: '自定义…',
              type: 'radio',
              checked: imageSetting().mode === 'custom',
              click: () => {
                buildMenu()
                send(IPC.settingsShow, 'images')
              },
            },
          ],
        },
        { label: '设置…', accelerator: 'Ctrl+,', click: () => send(IPC.settingsShow) },
        { type: 'separator' },
        { label: '退出', accelerator: 'Alt+F4', click: () => mainWindow?.close() },
      ],
    },
    {
      label: '编辑(&E)',
      submenu: [
        { role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' },
        { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
        { type: 'separator' },
        {
          label: '插入图片…',
          accelerator: 'Ctrl+Shift+I',
          click: () => send(IPC.documentCommand, { action: 'insertImage' }),
        },
        { type: 'separator' },
        {
          label: '拼写检查',
          type: 'checkbox',
          checked: preferences().spellcheck,
          click: (item) => void updatePreferences({ spellcheck: item.checked }),
        },
      ],
    },
    {
      label: '视图(&V)',
      submenu: [
        view('切换源码', 'Ctrl+/', 'toggle'),
        view('所见即所得', 'Ctrl+1', 'visual'), view('Markdown 源码', 'Ctrl+2', 'source'),
        view('阅读模式（只读）', 'Ctrl+3', 'reading'),
        { type: 'separator' },
        { label: '主题', submenu: [theme('跟随系统', 'system'), theme('浅色', 'light'), theme('深色', 'dark')] },
        { type: 'separator' },
        // Electron's zoom role only answers Ctrl+Shift+= on Windows keyboards; the hidden items add Ctrl+= and the keypad.
        { label: '放大', accelerator: 'Ctrl+=', click: () => zoom(1) },
        { label: '放大', accelerator: 'Ctrl+Plus', visible: false, click: () => zoom(1) },
        { label: '放大', accelerator: 'Ctrl+numadd', visible: false, click: () => zoom(1) },
        { label: '缩小', accelerator: 'Ctrl+-', click: () => zoom(-1) },
        { label: '缩小', accelerator: 'Ctrl+numsub', visible: false, click: () => zoom(-1) },
        { label: '重置缩放', accelerator: 'Ctrl+0', click: () => zoom(0) },
        { label: '重置缩放', accelerator: 'Ctrl+num0', visible: false, click: () => zoom(0) },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    {
      label: '帮助(&H)',
      submenu: [
        {
          label: updateMenuLabels[updatePhase],
          enabled: updatePhase !== 'checking',
          click: () => {
            if (updatePhase === 'downloading') updates.cancelDownload()
            else void updates.check()
          },
        },
        { label: '访问发布页面', click: () => void shell.openExternal(RELEASES_URL) },
        { type: 'separator' },
        { label: '意见反馈…', click: () => send(IPC.feedbackShow) },
        { label: '关于 Inkdown', click: () => void showAbout() },
      ],
    },
  ]))
}

function showAbout(): Promise<unknown> {
  return showMessage({
    type: 'info',
    title: '关于 Inkdown',
    message: `Inkdown v${app.getVersion()}`,
    detail: [
      '安全、本地优先的 Windows Markdown 实时编辑器。',
      `Electron ${process.versions.electron} · Chromium ${process.versions.chrome} · Node.js ${process.versions.node}`,
    ].join('\n\n'),
    buttons: ['确定'],
    noLink: true,
  })
}

async function openDocument(filePath: string) {
  const result = await documents.openPath(filePath)
  if (result.missing) void settings.removeRecent(filePath).then(() => buildMenu(), () => undefined)
  return result
}

/** Files opened from Explorer wait until any crash draft has been offered: opening a file deletes the draft. */
async function openFromShell(filePath: string): Promise<void> {
  await documents.whenInitialized()
  const result = await openDocument(filePath)
  if (!result.ok && result.error) void showMessage({ type: 'error', title: '无法打开文件', message: result.error, noLink: true })
}

/** A mapped drive that is disconnected can block for many seconds; the check gives up instead. */
function exists(filePath: string, timeout = 1_500): Promise<boolean> {
  return Promise.race([
    stat(filePath).then((info) => info.isFile(), () => false),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeout).unref()),
  ])
}

async function lastDocument(): Promise<string | undefined> {
  const [recent] = settings.get().recentFiles
  const current = documents.current()
  if (!preferences().reopenLastDocument || !recent || current.filePath || current.dirty) return undefined
  return await exists(recent) ? recent : undefined
}

function startExternalChangeMonitor(): void {
  clearInterval(externalChangeTimer)
  externalChangeTimer = setInterval(async () => {
    const current = documents.current()
    if (!current.filePath || externalPromptActive || documents.busy()) return
    const filePath = current.filePath
    const known = documents.getKnownModifiedAt()
    let diskModifiedAt: number
    try {
      diskModifiedAt = (await stat(filePath)).mtimeMs
    } catch (error) {
      if ((error as { code?: unknown }).code !== 'ENOENT' || missingNoticePath === filePath) return
      missingNoticePath = filePath
      documents.notify(`“${current.fileName}”已被删除或移动，保存时会在原位置重新创建`)
      return
    }
    missingNoticePath = null
    // The check is skipped if a save or another document took over while the disk was read.
    if (diskModifiedAt <= known + 1 || documents.current().filePath !== filePath || documents.busy()) return
    externalPromptActive = true
    try {
      const owner = mainWindow
      if (!owner) return
      const response = (await dialog.showMessageBox(owner, {
        type: 'warning',
        buttons: ['重新加载', '保留当前内容'],
        defaultId: 0,
        cancelId: 1,
        title: '文件已在外部修改',
        message: `${current.fileName} 已被其他程序修改。`,
        detail: documents.current().dirty ? '重新加载会丢弃当前未保存更改。' : undefined,
        noLink: true,
      })).response
      if (documents.current().filePath !== filePath) return
      if (response === 0) await documents.openPath(filePath, true)
      else documents.acknowledgeModifiedAt(diskModifiedAt)
    } finally {
      externalPromptActive = false
    }
  }, 2_000)
  externalChangeTimer.unref()
}

registerImageScheme()
const lock = app.requestSingleInstanceLock()
if (!lock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv, workingDirectory) => {
    if (mainWindow?.isMinimized()) mainWindow.restore()
    mainWindow?.show()
    mainWindow?.focus()
    const candidate = argv.slice(1).map((arg) => path.resolve(workingDirectory, arg)).find(isDocumentPath)
    if (!candidate) return
    if (documentsReady) void openFromShell(candidate)
    else pendingDocumentPath = candidate
  })
  app.whenReady().then(async () => {
    await createWindow()
    if (!mainWindow) return
    const draft = await readFile(recoveryDraft(), 'utf8').catch(() => '')
    void cleanStagedImages(stagedImages(), draft)
    const candidate = pendingDocumentPath ?? process.argv.slice(1).map((arg) => path.resolve(arg)).find(isDocumentPath)
    pendingDocumentPath = null
    if (candidate) {
      await openFromShell(candidate)
      return
    }
    await documents.whenInitialized()
    const recent = await lastDocument()
    if (recent) await openDocument(recent)
  })
  app.on('before-quit', () => { quitting = true })
  app.on('window-all-closed', () => app.quit())
}
