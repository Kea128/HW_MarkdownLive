import type { MessageBoxOptions } from 'electron'
import type { CancellationToken, LoginHandler, ProgressInfo, UpdateInfo } from 'electron-updater'
import type { UpdateState } from '../../src/contracts'
import {
  describeUpdateError, formatDownloadSize, releaseNotesToText, releasePageUrl, RELEASES_URL,
  UPDATE_TIMEOUT_CODE, type InstallKind,
} from './update-policy'

const CHECK_TIMEOUT_MS = 60_000

export interface Updater {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  disableWebInstaller: boolean
  checkForUpdates(): Promise<{
    isUpdateAvailable: boolean
    updateInfo: Pick<UpdateInfo, 'version' | 'releaseNotes' | 'files'>
  } | null>
  downloadUpdate(cancellationToken?: CancellationToken): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
  on(event: 'download-progress', listener: (info: ProgressInfo) => void): unknown
  on(event: 'login', listener: LoginHandler): unknown
}

export interface UpdaterModule {
  updater: Updater
  createCancellationToken(): CancellationToken
}

export interface UpdateControllerOptions {
  loadUpdater(): Promise<UpdaterModule>
  kind: InstallKind
  currentVersion: string
  checkTimeoutMs?: number
  showMessageBox(options: MessageBoxOptions): Promise<{ response: number }>
  openExternal(url: string): Promise<unknown>
  confirmQuit(): Promise<boolean>
  onState(state: UpdateState, previous: UpdateState): void
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(Object.assign(
      new Error(`检查更新超过 ${Math.round(timeoutMs / 1000)} 秒仍未完成`),
      { code: UPDATE_TIMEOUT_CODE },
    )), timeoutMs)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

export class UpdateController {
  private value: UpdateState = { phase: 'idle' }
  private running = false
  private updaterModule?: Promise<UpdaterModule>
  private downloadToken?: CancellationToken

  constructor(private readonly options: UpdateControllerOptions) {}

  state(): UpdateState {
    return this.value
  }

  async check(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      if (this.value.phase === 'downloaded') await this.promptInstall(this.value.version)
      else await this.checkAndOffer()
    } finally {
      this.running = false
    }
  }

  cancelDownload(): void {
    this.downloadToken?.cancel()
  }

  private loadUpdater(): Promise<UpdaterModule> {
    this.updaterModule ??= this.options.loadUpdater().then((loaded) => {
      const { updater } = loaded
      updater.autoDownload = false
      updater.autoInstallOnAppQuit = true
      updater.disableWebInstaller = true
      updater.on('download-progress', ({ percent }) => {
        if (this.value.phase === 'downloading') this.setState({ ...this.value, percent })
      })
      // Without a credentials prompt the request must be released: calling back with no arguments
      // cancels proxy authentication, whereas never calling back leaves the request pending forever.
      updater.on('login', (_authInfo, callback) => (callback as () => void)())
      return loaded
    }, (error: unknown) => {
      this.updaterModule = undefined
      throw error
    })
    return this.updaterModule
  }

  private async checkAndOffer(): Promise<void> {
    if (this.options.kind === 'development') return this.showUnsupported()
    this.setState({ phase: 'checking' })
    let result: Awaited<ReturnType<Updater['checkForUpdates']>>
    try {
      const { updater } = await this.loadUpdater()
      result = await withTimeout(updater.checkForUpdates(), this.options.checkTimeoutMs ?? CHECK_TIMEOUT_MS)
    } catch (error) {
      this.setState({ phase: 'idle' })
      return this.showError('检查更新失败', error)
    }
    this.setState({ phase: 'idle' })
    if (!result) return this.showUnsupported()
    if (!result.isUpdateAvailable) return this.showUpToDate()

    const { version, releaseNotes, files } = result.updateInfo
    const installable = this.options.kind === 'installed'
    const notes = releaseNotesToText(releaseNotes)
    const size = formatDownloadSize(files?.find(({ url }) => url.endsWith('.exe'))?.size)
    const { response } = await this.options.showMessageBox({
      type: 'info',
      title: '发现新版本',
      message: `发现新版本 Inkdown v${version}`,
      detail: [
        installable && size
          ? `当前版本：v${this.options.currentVersion}，安装包约 ${size}`
          : `当前版本：v${this.options.currentVersion}`,
        installable ? '' : '便携版和 ZIP 版无法自动替换程序文件，请下载新版本后手动替换。',
        notes && `更新内容：\n${notes}`,
      ].filter(Boolean).join('\n\n'),
      buttons: [installable ? '下载并安装' : '打开下载页面', '稍后'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    })
    if (response !== 0) return
    if (!installable) {
      await this.options.openExternal(releasePageUrl(version))
      return
    }
    await this.download(version)
  }

  private async download(version: string): Promise<void> {
    const { updater, createCancellationToken } = await this.loadUpdater()
    const token = createCancellationToken()
    this.downloadToken = token
    this.setState({ phase: 'downloading', version, percent: 0 })
    try {
      await updater.downloadUpdate(token).finally(() => { this.downloadToken = undefined })
    } catch (error) {
      this.setState({ phase: 'idle' })
      if (!token.cancelled) await this.showError('下载更新失败', error)
      return
    }
    this.setState({ phase: 'downloaded', version })
    await this.promptInstall(version)
  }

  private async promptInstall(version: string): Promise<void> {
    const { response } = await this.options.showMessageBox({
      type: 'info',
      title: '更新已就绪',
      message: `Inkdown v${version} 已下载完成`,
      detail: '立即重启即可完成更新。选择“稍后”会在退出 Inkdown 时自动安装。',
      buttons: ['立即重启并更新', '稍后'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    })
    if (response !== 0 || !(await this.options.confirmQuit())) return
    const { updater } = await this.loadUpdater()
    updater.quitAndInstall(true, true)
  }

  private async showUpToDate(): Promise<void> {
    await this.options.showMessageBox({
      type: 'info',
      title: '检查更新',
      message: '当前已是最新版本',
      detail: `Inkdown v${this.options.currentVersion} 是目前发布的最新版本。`,
      buttons: ['确定'],
      noLink: true,
    })
  }

  private async showUnsupported(): Promise<void> {
    await this.options.showMessageBox({
      type: 'info',
      title: '检查更新',
      message: '开发版本不支持在线更新',
      detail: '请使用 Windows 安装包安装 Inkdown 后，再通过“帮助 > 检查更新”升级。',
      buttons: ['确定'],
      noLink: true,
    })
  }

  private async showError(title: string, error: unknown): Promise<void> {
    const { message, detail } = describeUpdateError(error)
    const { response } = await this.options.showMessageBox({
      type: 'warning',
      title,
      message,
      detail: `${detail}\n\n也可以前往 GitHub 发布页面手动下载最新版本。`,
      buttons: ['打开发布页面', '关闭'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    })
    if (response === 0) await this.options.openExternal(RELEASES_URL)
  }

  private setState(state: UpdateState): void {
    const previous = this.value
    this.value = state
    this.options.onState(state, previous)
  }
}
