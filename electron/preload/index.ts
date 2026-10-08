import { contextBridge, ipcRenderer, webUtils } from 'electron'
import {
  IPC, type DocumentCommand, type DocumentSnapshot, type InkdownApi, type Theme, type UpdateState,
  type ViewMode,
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
}

contextBridge.exposeInMainWorld('inkdown', Object.freeze(api))
