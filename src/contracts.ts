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
  updateState: 'update:state',
  workspaceGet: 'workspace:get',
  workspaceOpen: 'workspace:open',
  workspaceRefresh: 'workspace:refresh',
  workspaceClose: 'workspace:close',
  workspaceUpdated: 'workspace:updated',
  feedbackSubmit: 'feedback:submit',
  feedbackOpenFolder: 'feedback:open-folder',
  feedbackShow: 'feedback:show',
  imageSave: 'image:save',
  imageChoose: 'image:choose',
  imageOpen: 'image:open',
  imageReveal: 'image:reveal',
  imageCopy: 'image:copy',
  settingsGetImageFolder: 'settings:get-image-folder',
  settingsSetImageFolder: 'settings:set-image-folder',
  settingsShow: 'settings:show',
} as const

export type ViewMode = 'visual' | 'source' | 'toggle'
export type Theme = 'system' | 'light' | 'dark'
export type DocumentCommand =
  | { action: 'new' | 'open' | 'save' | 'saveAs' | 'close' | 'insertImage' }
  | { action: 'openPath'; filePath: string }
export type UpdateState =
  | { phase: 'idle' | 'checking' }
  | { phase: 'downloading'; version: string; percent: number }
  | { phase: 'downloaded'; version: string }

export interface WorkspaceEntry {
  name: string
  path: string
  children?: WorkspaceEntry[]
}

export interface WorkspaceSnapshot {
  root: string
  name: string
  entries: WorkspaceEntry[]
  fileCount: number
  truncated: boolean
}

export type FeedbackChannel = 'github' | 'copy'

export interface FeedbackInput {
  type: string
  area: string
  title: string
  details: string
  contact: string
  includeEnvironment: boolean
}

export type FeedbackResult =
  | { ok: true; id: string; tags: string[]; truncated: boolean }
  | { ok: false; error: string }

export type ImageFolderMode = 'document-assets' | 'document-name' | 'shared-assets' | 'custom'

export interface ImageFolderSetting {
  mode: ImageFolderMode
  /** Folder for `custom`, relative to the document or absolute; `${filename}` is the document name. */
  template: string
}

export interface ImageInput {
  name: string
  type: string
  data?: Uint8Array
  sourcePath?: string
}

export type ImageSaveResult =
  | { ok: true; src: string; location: 'saved' | 'linked' | 'staged' }
  | { ok: false; error: string }

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
  updates: {
    onState(listener: (state: UpdateState) => void): () => void
  }
  workspace: {
    get(): Promise<WorkspaceSnapshot | null>
    open(): Promise<WorkspaceSnapshot | null>
    refresh(): Promise<WorkspaceSnapshot | null>
    close(): Promise<null>
    onUpdated(listener: (snapshot: WorkspaceSnapshot | null) => void): () => void
  }
  feedback: {
    submit(input: FeedbackInput, channel: FeedbackChannel): Promise<FeedbackResult>
    openFolder(): Promise<void>
    onShow(listener: () => void): () => void
  }
  images: {
    save(input: ImageInput): Promise<ImageSaveResult>
    choose(): Promise<ImageSaveResult[]>
    open(src: string): Promise<boolean>
    reveal(src: string): Promise<boolean>
    copy(src: string): Promise<boolean>
  }
  settings: {
    getImageFolder(): Promise<ImageFolderSetting>
    setImageFolder(setting: ImageFolderSetting): Promise<{ ok: true } | { ok: false; error: string }>
    onShow(listener: () => void): () => void
  }
}
