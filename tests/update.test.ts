import { describe, expect, it, vi } from 'vitest'
import type { UpdateState } from '../src/contracts'
import { UpdateController, type Updater } from '../electron/main/update-controller'
import {
  describeUpdateError, detectInstallKind, formatDownloadSize, releaseNotesToText, releasePageUrl,
  RELEASES_URL, UPDATE_TIMEOUT_CODE, type InstallKind,
} from '../electron/main/update-policy'

function createUpdater(overrides: Partial<Updater> = {}) {
  const listeners: Record<string, (...args: never[]) => void> = {}
  const updater = {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    disableWebInstaller: false,
    checkForUpdates: vi.fn(async () => ({
      isUpdateAvailable: true,
      updateInfo: {
        version: '2.8.0',
        releaseNotes: '<h3>新增</h3><ul><li>在线更新</li></ul>',
        files: [{ url: 'Inkdown-2.8.0-x64-setup.exe', size: 101_541_773, sha512: '' }],
      },
    })),
    downloadUpdate: vi.fn(async () => {
      listeners['download-progress']?.({ percent: 42.5 } as never)
      return ['C:\\cache\\Inkdown-2.8.0-x64-setup.exe']
    }),
    quitAndInstall: vi.fn(),
    on: vi.fn((event: string, listener: (...args: never[]) => void) => { listeners[event] = listener }),
    ...overrides,
  }
  return Object.assign(updater, { listeners })
}

function createController(
  kind: InstallKind,
  responses: number[] = [],
  updater = createUpdater(),
  overrides: { checkTimeoutMs?: number } = {},
) {
  const states: UpdateState[] = []
  const options = {
    loadUpdater: vi.fn(async () => ({
      updater,
      createCancellationToken: () => ({ cancelled: false, cancel() { this.cancelled = true } }),
    })),
    kind,
    currentVersion: '2.7.0',
    showMessageBox: vi.fn(async (_options: Electron.MessageBoxOptions) => ({ response: responses.shift() ?? 1 })),
    openExternal: vi.fn(async () => undefined),
    confirmQuit: vi.fn(async () => true),
    onState: vi.fn((state: UpdateState) => { states.push(state) }),
    ...overrides,
  }
  const controller = new UpdateController(options as never)
  const messages = () => options.showMessageBox.mock.calls.map(([dialog]) => dialog.message)
  return { controller, options, updater, states, messages }
}

describe('在线更新策略', () => {
  it('区分开发、便携、安装和 ZIP 版本', () => {
    const base = { execPath: 'C:\\Apps\\Inkdown\\Inkdown.exe', env: {}, exists: () => false }
    expect(detectInstallKind({ ...base, isPackaged: false })).toBe('development')
    expect(detectInstallKind({
      ...base, isPackaged: true, env: { PORTABLE_EXECUTABLE_FILE: 'D:\\Inkdown-portable.exe' },
    })).toBe('portable')
    expect(detectInstallKind({
      ...base, isPackaged: true, exists: (file) => file === 'C:\\Apps\\Inkdown\\Uninstall Inkdown.exe',
    })).toBe('installed')
    expect(detectInstallKind({ ...base, isPackaged: true })).toBe('archive')
  })

  it('把 GitHub 发布说明转换为纯文本，并优先按整行截断', () => {
    expect(releaseNotesToText('<h3>修复</h3>\n<ul>\n<li>\n<p>A &amp; B&#39;s <code>&lt;tag&gt;</code></p>\n</li>\n<li>第二项</li>\n</ul>'))
      .toBe("修复\n• A & B's <tag>\n• 第二项")
    expect(releaseNotesToText([{ note: '<p>一</p>' }, { note: null }, { note: '二&#x4E8C;' }])).toBe('一\n二二')
    expect(releaseNotesToText(null)).toBe('')
    expect(releaseNotesToText('第一行\n第二行很长\n第三行', 10)).toBe('第一行\n第二行很长\n…')
    expect(releaseNotesToText('很长的说明'.repeat(20), 10)).toBe('很长的说明很长的说…')
    expect(releasePageUrl('2.8.0')).toBe(`${RELEASES_URL}/tag/v2.8.0`)
  })

  it('格式化安装包大小', () => {
    expect(formatDownloadSize(101_541_773)).toBe('97 MB')
    expect(formatDownloadSize(1_000)).toBe('1 MB')
    expect(formatDownloadSize(undefined)).toBeNull()
    expect(formatDownloadSize(0)).toBeNull()
  })

  it('将常见更新错误转换为可操作的提示', () => {
    const coded = (message: string, code: string) => Object.assign(new Error(message), { code })
    expect(describeUpdateError(new Error('net::ERR_PROXY_CONNECTION_FAILED')).message).toContain('网络或代理')
    expect(describeUpdateError(coded('检查更新超过 60 秒仍未完成', UPDATE_TIMEOUT_CODE)).message)
      .toBe('连接 GitHub 超时，请检查网络或代理设置后重试。')
    expect(describeUpdateError(Object.assign(new Error('407 Proxy Authentication Required'), { statusCode: 407 })).message)
      .toContain('代理服务器要求身份验证')
    expect(describeUpdateError(new Error('net::ERR_PROXY_AUTH_UNSUPPORTED')).message).toContain('代理服务器要求身份验证')
    expect(describeUpdateError(coded('Unable to find latest version', 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND')).message)
      .toBe('GitHub 上暂未找到已发布的正式版本。')
    expect(describeUpdateError(coded('Cannot find latest.yml', 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND')).message)
      .toContain('latest.yml')
    expect(describeUpdateError(coded('sha512 checksum mismatch', 'ERR_CHECKSUM_MISMATCH')).message).toContain('完整性校验')
    expect(describeUpdateError(Object.assign(new Error('HttpError: 403'), { statusCode: 403 })).message)
      .toContain('限制了访问')
    expect(describeUpdateError(coded('no space', 'ENOSPC')).message).toContain('磁盘空间不足')
    expect(describeUpdateError('boom')).toEqual({
      message: '更新服务暂时不可用，请稍后再试。',
      detail: '错误信息：boom',
    })
  })
})

describe('在线更新流程', () => {
  it('安装版下载、校验完成后确认保存再重启安装', async () => {
    const { controller, updater, options, states, messages } = createController('installed', [0, 0])
    await controller.check()
    expect(messages()).toEqual(['发现新版本 Inkdown v2.8.0', 'Inkdown v2.8.0 已下载完成'])
    expect(options.showMessageBox.mock.calls[0][0].detail)
      .toBe('当前版本：v2.7.0，安装包约 97 MB\n\n更新内容：\n新增\n• 在线更新')
    expect(states).toEqual([
      { phase: 'checking' },
      { phase: 'idle' },
      { phase: 'downloading', version: '2.8.0', percent: 0 },
      { phase: 'downloading', version: '2.8.0', percent: 42.5 },
      { phase: 'downloaded', version: '2.8.0' },
    ])
    expect(options.confirmQuit).toHaveBeenCalledOnce()
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true)
  })

  it('首次检查时才加载更新模块，并取消代理身份验证以免请求挂起', async () => {
    const { controller, options, updater } = createController('installed', [1, 1])
    expect(options.loadUpdater).not.toHaveBeenCalled()
    expect(updater.autoDownload).toBe(true)
    await controller.check()
    await controller.check()
    expect(options.loadUpdater).toHaveBeenCalledOnce()
    expect(updater).toMatchObject({ autoDownload: false, autoInstallOnAppQuit: true, disableWebInstaller: true })
    const callback = vi.fn()
    updater.listeners.login({} as never, callback as never)
    expect(callback).toHaveBeenCalledWith()
  })

  it('更新模块加载失败时提示错误，下次检查重新加载', async () => {
    const { controller, options, messages } = createController('installed', [1, 1])
    options.loadUpdater.mockRejectedValueOnce(new Error("Cannot find module 'electron-updater'"))
    await controller.check()
    expect(options.showMessageBox.mock.calls[0][0].title).toBe('检查更新失败')
    expect(controller.state()).toEqual({ phase: 'idle' })
    await controller.check()
    expect(options.loadUpdater).toHaveBeenCalledTimes(2)
    expect(messages().at(-1)).toBe('发现新版本 Inkdown v2.8.0')
  })

  it('检查超时后恢复空闲并提示，避免一直停留在检查中', async () => {
    const updater = createUpdater({ checkForUpdates: vi.fn(() => new Promise<never>(() => undefined)) })
    const { controller, options } = createController('installed', [1], updater, { checkTimeoutMs: 5 })
    await controller.check()
    expect(controller.state()).toEqual({ phase: 'idle' })
    expect(options.showMessageBox.mock.calls[0][0]).toMatchObject({
      title: '检查更新失败', message: '连接 GitHub 超时，请检查网络或代理设置后重试。',
    })
  })

  it('下载中可以取消，取消后不弹出错误', async () => {
    let rejectDownload: (error: Error) => void = () => undefined
    const updater = createUpdater({
      downloadUpdate: vi.fn(() => new Promise((_resolve, reject) => { rejectDownload = reject })),
    })
    const { controller, options } = createController('installed', [0], updater)
    controller.cancelDownload()
    const checking = controller.check()
    await vi.waitFor(() => expect(controller.state().phase).toBe('downloading'))
    controller.cancelDownload()
    rejectDownload(new Error('cancelled'))
    await checking
    expect(updater.downloadUpdate.mock.calls[0][0]).toMatchObject({ cancelled: true })
    expect(controller.state()).toEqual({ phase: 'idle' })
    expect(options.showMessageBox).toHaveBeenCalledOnce()
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
  })

  it('稍后安装时保留已下载更新，再次检查直接提示重启', async () => {
    const { controller, updater, options, messages } = createController('installed', [0, 1, 0])
    options.confirmQuit.mockResolvedValueOnce(false)
    await controller.check()
    expect(controller.state()).toEqual({ phase: 'downloaded', version: '2.8.0' })
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
    await controller.check()
    expect(updater.checkForUpdates).toHaveBeenCalledOnce()
    expect(messages().at(-1)).toBe('Inkdown v2.8.0 已下载完成')
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
  })

  it('便携版和 ZIP 版只打开对应版本的下载页面', async () => {
    for (const kind of ['portable', 'archive'] as const) {
      const { controller, updater, options } = createController(kind, [0])
      await controller.check()
      expect(options.showMessageBox.mock.calls[0][0]).toMatchObject({
        buttons: ['打开下载页面', '稍后'],
        detail: expect.not.stringContaining('安装包约'),
      })
      expect(options.openExternal).toHaveBeenCalledWith(releasePageUrl('2.8.0'))
      expect(updater.downloadUpdate).not.toHaveBeenCalled()
    }
  })

  it('提示已是最新版本，开发版本不加载更新模块', async () => {
    const latest = createController('installed', [], createUpdater({
      checkForUpdates: vi.fn(async () => ({
        isUpdateAvailable: false, updateInfo: { version: '2.7.0', releaseNotes: null, files: [] },
      })),
    }))
    await latest.controller.check()
    expect(latest.messages()).toEqual(['当前已是最新版本'])

    const development = createController('development')
    await development.controller.check()
    expect(development.options.loadUpdater).not.toHaveBeenCalled()
    expect(development.messages()).toEqual(['开发版本不支持在线更新'])
  })

  it('检查或下载失败时恢复空闲状态并提供发布页面', async () => {
    const failedCheck = createController('installed', [0], createUpdater({
      checkForUpdates: vi.fn(async () => { throw new Error('net::ERR_INTERNET_DISCONNECTED') }),
    }))
    await failedCheck.controller.check()
    expect(failedCheck.controller.state()).toEqual({ phase: 'idle' })
    expect(failedCheck.options.showMessageBox.mock.calls[0][0]).toMatchObject({
      title: '检查更新失败', message: '无法连接到 GitHub，请检查网络或代理设置后重试。',
    })
    expect(failedCheck.options.openExternal).toHaveBeenCalledWith(RELEASES_URL)

    const failedDownload = createController('installed', [0, 1], createUpdater({
      downloadUpdate: vi.fn(async () => { throw new Error('sha512 checksum mismatch') }),
    }))
    await failedDownload.controller.check()
    expect(failedDownload.controller.state()).toEqual({ phase: 'idle' })
    expect(failedDownload.options.showMessageBox.mock.calls[1][0].title).toBe('下载更新失败')
    expect(failedDownload.updater.quitAndInstall).not.toHaveBeenCalled()
  })

  it('并发触发时只执行一次检查', async () => {
    const { controller, updater } = createController('installed', [1])
    await Promise.all([controller.check(), controller.check()])
    expect(updater.checkForUpdates).toHaveBeenCalledOnce()
  })
})
