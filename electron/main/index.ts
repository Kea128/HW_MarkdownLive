import path from 'node:path'
import { stat } from 'node:fs/promises'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  screen,
  shell,
  type MenuItemConstructorOptions,
} from 'electron'
import { IPC, type Theme, type ViewMode } from '../../src/contracts'
import { DocumentController } from './document-controller'
import { FileService } from './file-service'
import { SettingsStore } from './settings-store'
import { isDocumentContent, isDocumentPath, isSafeExternalUrl } from './validators'
import { restoreBounds } from './window-state'

let mainWindow: BrowserWindow | null = null
let documents: DocumentController
let settings: SettingsStore
let quitting = false
let externalPromptActive = false
let externalChangeTimer: NodeJS.Timeout | undefined
let documentsReady = false
let pendingDocumentPath: string | null = null

const send = (channel: string, ...args: unknown[]) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args)
}

const trustedEvent = (senderId: number) => mainWindow?.webContents.id === senderId
const isTheme = (value: unknown): value is Theme =>
  value === 'system' || value === 'light' || value === 'dark'
const setAppTheme = (theme: Theme) => {
  nativeTheme.themeSource = theme
  send(IPC.themeChanged, theme)
  buildMenu()
  return theme
}

async function createWindow(): Promise<void> {
  settings = new SettingsStore(path.join(app.getPath('userData'), 'settings.json'))
  await settings.load()
  const displays = screen.getAllDisplays().map(({ workArea }) => workArea)
  const bounds = restoreBounds(settings.get().bounds, displays)

  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 800,
    minHeight: 560,
    show: false,
    backgroundColor: '#f7f7f5',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })

  documents = new DocumentController(
    () => mainWindow,
    new FileService(),
    path.join(app.getPath('userData'), 'recovery-draft.json'),
    (snapshot) => {
      send(IPC.documentUpdated, snapshot)
      if (mainWindow) mainWindow.setTitle(`${snapshot.dirty ? '*' : ''}${snapshot.fileName} — Inkdown`)
    },
    (filePath) => void settings.addRecent(filePath).then(() => buildMenu()),
  )
  documentsReady = true

  registerIpc()
  buildMenu()
  secureWindow(mainWindow)

  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl && /^http:\/\/(127\.0\.0\.1|localhost):\d+\/?$/.test(devUrl)) {
    await mainWindow.loadURL(devUrl)
  } else {
    await mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    send(IPC.documentCommand, { action: 'close' })
  })
  mainWindow.on('closed', () => {
    clearInterval(externalChangeTimer)
    externalChangeTimer = undefined
    mainWindow = null
  })
  let boundsTimer: NodeJS.Timeout | undefined
  const persistBounds = () => {
    clearTimeout(boundsTimer)
    boundsTimer = setTimeout(() => {
      if (mainWindow && !mainWindow.isMaximized() && !mainWindow.isMinimized()) {
        void settings.update({ bounds: mainWindow.getBounds() })
      }
    }, 300)
  }
  mainWindow.on('resize', persistBounds)
  mainWindow.on('move', persistBounds)
  startExternalChangeMonitor()
}

function secureWindow(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: http:; font-src 'self'; connect-src 'self' http://127.0.0.1:* http://localhost:*; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'",
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
      ? documents.openPath(filePath)
      : { ok: false, error: '无效文件路径' })
  ipcMain.handle(IPC.documentSave, (event) => trustedEvent(event.sender.id) ? documents.save() : { ok: false })
  ipcMain.handle(IPC.documentSaveAs, (event) => trustedEvent(event.sender.id) ? documents.save(true) : { ok: false })
  ipcMain.handle(IPC.documentClose, async (event) => {
    if (!trustedEvent(event.sender.id) || !(await documents.confirmDiscard())) {
      return { ok: false, canceled: true }
    }
    quitting = true
    app.quit()
    return { ok: true }
  })
  ipcMain.handle(IPC.documentChanged, (event, content) => {
    if (trustedEvent(event.sender.id) && isDocumentContent(content)) documents.changed(content)
  })
  ipcMain.handle(IPC.themeSet, (event, theme) => {
    if (!trustedEvent(event.sender.id) || !isTheme(theme)) return nativeTheme.themeSource
    return setAppTheme(theme)
  })
  ipcMain.handle(IPC.externalOpen, (event, url) => {
    if (!trustedEvent(event.sender.id) || !isSafeExternalUrl(url)) return false
    return shell.openExternal(url).then(() => true, () => false)
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
    checked: nativeTheme.themeSource === value,
    click: () => setAppTheme(value),
  })
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: '文件(&F)',
      submenu: [
        { label: '新建', accelerator: 'Ctrl+N', click: () => send(IPC.documentCommand, { action: 'new' }) },
        { label: '打开…', accelerator: 'Ctrl+O', click: () => send(IPC.documentCommand, { action: 'open' }) },
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
        { label: '退出', accelerator: 'Alt+F4', click: () => mainWindow?.close() },
      ],
    },
    {
      label: '编辑(&E)',
      submenu: [
        { role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' },
        { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图(&V)',
      submenu: [
        view('切换源码', 'Ctrl+/', 'toggle'),
        view('所见即所得', 'Ctrl+1', 'visual'), view('Markdown 源码', 'Ctrl+2', 'source'),
        { type: 'separator' },
        { label: '主题', submenu: [theme('跟随系统', 'system'), theme('浅色', 'light'), theme('深色', 'dark')] },
        { type: 'separator' }, { role: 'zoomIn', label: '放大' }, { role: 'zoomOut', label: '缩小' },
        { role: 'resetZoom', label: '重置缩放' }, { role: 'togglefullscreen', label: '全屏' },
      ],
    },
  ]))
}

function startExternalChangeMonitor(): void {
  clearInterval(externalChangeTimer)
  externalChangeTimer = setInterval(async () => {
    const current = documents.current()
    if (!current.filePath || externalPromptActive) return
    try {
      const diskModifiedAt = (await stat(current.filePath)).mtimeMs
      if (diskModifiedAt <= documents.getKnownModifiedAt() + 1) return
      externalPromptActive = true
      const owner = mainWindow
      if (!owner) return
      const response = (await dialog.showMessageBox(owner, {
        type: 'warning',
        buttons: ['重新加载', '保留当前内容'],
        defaultId: 0,
        cancelId: 1,
        title: '文件已在外部修改',
        message: `${current.fileName} 已被其他程序修改。`,
        detail: current.dirty ? '重新加载会丢弃当前未保存更改。' : undefined,
      })).response
      if (response === 0) await documents.openPath(current.filePath, true)
      else documents.acknowledgeModifiedAt(diskModifiedAt)
    } catch {
      // A temporarily inaccessible file is checked again later.
    } finally {
      externalPromptActive = false
    }
  }, 2_000)
  externalChangeTimer.unref()
}

const lock = app.requestSingleInstanceLock()
if (!lock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    mainWindow?.restore()
    mainWindow?.focus()
    const candidate = argv.find(isDocumentPath)
    if (!candidate) return
    if (documentsReady) void documents.openPath(candidate)
    else pendingDocumentPath = candidate
  })
  app.whenReady().then(async () => {
    await createWindow()
    const candidate = pendingDocumentPath ?? process.argv.find(isDocumentPath)
    pendingDocumentPath = null
    if (candidate) await documents.openPath(candidate)
  })
  app.on('before-quit', () => { quitting = true })
  app.on('window-all-closed', () => app.quit())
}
