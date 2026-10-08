import type { MessageBoxOptions } from 'electron'
import type { ProgressInfo, UpdateInfo } from 'electron-updater'
import type { UpdateState } from '../../src/contracts'
import {
  describeUpdateError, releaseNotesToText, releasePageUrl, RELEASES_URL, type InstallKind,
} from './update-policy'

export interface Updater {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  disableWebInstaller: boolean
  checkForUpdates(): Promise<{
    isUpdateAvailable: boolean
    updateInfo: Pick<UpdateInfo, 'version' | 'releaseNotes'>
  } | null>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
  on(event: 'download-progress', listener: (info: ProgressInfo) => void): unknown
}

export interface UpdateControllerOptions {
  updater: Updater
  kind: InstallKind
  currentVersion: string
  showMessageBox(options: MessageBoxOptions): Promise<{ response: number }>
  openExternal(url: string): Promise<unknown>
  confirmQuit(): Promise<boolean>
  onState(state: UpdateState, previous: UpdateState): void
}

export class UpdateController {
  private value: UpdateState = { phase: 'idle' }
  private running = false

  constructor(private readonly options: UpdateControllerOptions) {
    const { updater } = options
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = true
    updater.disableWebInstaller = true
    updater.on('download-progress', ({ percent }) => {
      if (this.value.phase === 'downloading') this.setState({ ...this.value, percent })
    })
  }

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

  private async checkAndOffer(): Promise<void> {
    if (this.options.kind === 'development') return this.showUnsupported()
    this.setState({ phase: 'checking' })
    let result: Awaited<ReturnType<Updater['checkForUpdates']>>
    try {
      result = await this.options.updater.checkForUpdates()
    } catch (error) {
      this.setState({ phase: 'idle' })
      return this.showError('检查更新失败', error)
    }
    this.setState({ phase: 'idle' })
    if (!result) return this.showUnsupported()
    if (!result.isUpdateAvailable) return this.showUpToDate()

    const { version, releaseNotes } = result.updateInfo
    const installable = this.options.kind === 'installed'
    const notes = releaseNotesToText(releaseNotes)
    const { response } = await this.options.showMessageBox({
      type: 'info',
      title: '发现新版本',
      message: `发现新版本 Inkdown v${version}`,
      detail: [
        `当前版本：v${this.options.currentVersion}`,
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
    this.setState({ phase: 'downloading', version, percent: 0 })
    try {
      await this.options.updater.downloadUpdate()
    } catch (error) {
      this.setState({ phase: 'idle' })
      return this.showError('下载更新失败', error)
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
    this.options.updater.quitAndInstall(true, true)
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
