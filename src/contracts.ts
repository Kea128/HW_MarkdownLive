export const IPC = {
  documentInit: 'document:init',
  documentNew: 'document:new',
  documentOpen: 'document:open',
  documentOpenPath: 'document:open-path',
  documentSave: 'document:save',
  documentSaveAs: 'document:save-as',
  documentClose: 'document:close',
  documentChanged: 'document:changed',
  documentUpdated: 'document:updated',
  documentCommand: 'document:command',
  viewMode: 'view:mode',
  themeChanged: 'theme:changed',
  themeSet: 'theme:set',
  externalOpen: 'external:open',
} as const

export type ViewMode = 'visual' | 'source' | 'toggle'
export type Theme = 'system' | 'light' | 'dark'
export type DocumentCommand =
  | { action: 'new' | 'open' | 'save' | 'saveAs' | 'close' }
  | { action: 'openPath'; filePath: string }

export interface DocumentSnapshot {
  content: string
  filePath: string | null
  fileName: string
  dirty: boolean
  recovered?: boolean
}

export interface OperationResult {
  ok: boolean
  canceled?: boolean
  error?: string
}

export interface InkdownApi {
  document: {
    initialize(): Promise<DocumentSnapshot>
    newDocument(): Promise<OperationResult>
    open(): Promise<OperationResult>
    openPath(filePath: string): Promise<OperationResult>
    save(): Promise<OperationResult>
    saveAs(): Promise<OperationResult>
    close(): Promise<OperationResult>
    pathForFile(file: File): string
    changed(content: string): Promise<void>
    onUpdated(listener: (snapshot: DocumentSnapshot) => void): () => void
    onCommand(listener: (command: DocumentCommand) => void): () => void
  }
  view: {
    onMode(listener: (mode: ViewMode) => void): () => void
    onTheme(listener: (theme: Theme) => void): () => void
    setTheme(theme: Theme): Promise<Theme>
  }
  external: {
    open(url: string): Promise<boolean>
  }
}
