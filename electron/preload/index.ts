import { contextBridge, ipcRenderer, webUtils } from 'electron'
import {
  IPC, type DocumentCommand, type DocumentSnapshot, type InkdownApi, type Preferences, type SettingsSection, type Theme,
  type UpdateState, type ViewMode, type WorkspaceSnapshot,
} from '../../src/contracts'

function subscription<T>(channel: string, listener: (value: T) => void): () => void {
  const wrapped = (_event: Electron.IpcRendererEvent, value: T) => listener(value)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}

const api: InkdownApi = {
  document: {
    initialize: () => ipcRenderer.invoke(IPC.documentInit),
    newDocument: () => ipcRenderer.invoke(IPC.documentNew),
    open: () => ipcRenderer.invoke(IPC.documentOpen),
    openPath: (filePath) => ipcRenderer.invoke(IPC.documentOpenPath, filePath),
    save: () => ipcRenderer.invoke(IPC.documentSave),
    saveAs: () => ipcRenderer.invoke(IPC.documentSaveAs),
    close: () => ipcRenderer.invoke(IPC.documentClose),
    pathForFile: (file) => webUtils.getPathForFile(file),
    changed: (content) => ipcRenderer.invoke(IPC.documentChanged, content),
    onUpdated: (listener) => subscription<DocumentSnapshot>(IPC.documentUpdated, listener),
    onCommand: (listener) => subscription<DocumentCommand>(IPC.documentCommand, listener),
  },
  view: {
    onMode: (listener) => subscription<ViewMode>(IPC.viewMode, listener),
    onTheme: (listener) => subscription<Theme>(IPC.themeChanged, listener),
    setTheme: (theme) => ipcRenderer.invoke(IPC.themeSet, theme),
  },
  external: {
    open: (url) => ipcRenderer.invoke(IPC.externalOpen, url),
  },
  updates: {
    onState: (listener) => subscription<UpdateState>(IPC.updateState, listener),
  },
  workspace: {
    get: () => ipcRenderer.invoke(IPC.workspaceGet),
    open: () => ipcRenderer.invoke(IPC.workspaceOpen),
    refresh: () => ipcRenderer.invoke(IPC.workspaceRefresh),
    close: () => ipcRenderer.invoke(IPC.workspaceClose),
    onUpdated: (listener) => subscription<WorkspaceSnapshot | null>(IPC.workspaceUpdated, listener),
  },
  feedback: {
    submit: (input, channel) => ipcRenderer.invoke(IPC.feedbackSubmit, input, channel),
    openFolder: () => ipcRenderer.invoke(IPC.feedbackOpenFolder),
    onShow: (listener) => subscription<void>(IPC.feedbackShow, () => listener()),
  },
  images: {
    save: (input) => ipcRenderer.invoke(IPC.imageSave, input),
    choose: () => ipcRenderer.invoke(IPC.imageChoose),
    open: (src) => ipcRenderer.invoke(IPC.imageOpen, src),
    reveal: (src) => ipcRenderer.invoke(IPC.imageReveal, src),
    copy: (src) => ipcRenderer.invoke(IPC.imageCopy, src),
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    set: (patch) => ipcRenderer.invoke(IPC.settingsSet, patch),
    onChanged: (listener) => subscription<Preferences>(IPC.settingsChanged, listener),
    onShow: (listener) => subscription<SettingsSection | undefined>(IPC.settingsShow, listener),
  },
}

contextBridge.exposeInMainWorld('inkdown', Object.freeze(api))
