import path from 'node:path'

export const RELEASES_URL = 'https://github.com/Kea128/HW_MarkdownLive/releases'

export type InstallKind = 'installed' | 'portable' | 'archive' | 'development'

export interface InstallEnvironment {
  isPackaged: boolean
  execPath: string
  env: Record<string, string | undefined>
  exists: (filePath: string) => boolean
}

export interface UpdateErrorDescription {
  message: string
  detail: string
}

type ReleaseNotes = string | ReadonlyArray<{ note: string | null }> | null | undefined

const NETWORK_ERROR = /net::ERR_(?:INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|NAME_RESOLUTION_FAILED|NETWORK_\w+|CONNECTION_\w+|TIMED_OUT|PROXY_\w+|TUNNEL_CONNECTION_FAILED|ADDRESS_UNREACHABLE|CERT_\w+|SSL_\w+)|\b(?:ENOTFOUND|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN)\b/
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
}

export function releasePageUrl(version: string): string {
  return `${RELEASES_URL}/tag/v${version}`
}

export function detectInstallKind({ isPackaged, execPath, env, exists }: InstallEnvironment): InstallKind {
  if (!isPackaged) return 'development'
  if (env.PORTABLE_EXECUTABLE_FILE) return 'portable'
  // Only the NSIS installer places an uninstaller next to the executable; ZIP copies have none.
  const uninstaller = path.win32.join(path.win32.dirname(execPath), 'Uninstall Inkdown.exe')
  return exists(uninstaller) ? 'installed' : 'archive'
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (!entity.startsWith('#')) return NAMED_ENTITIES[entity.toLowerCase()] ?? match
    const code = entity[1].toLowerCase() === 'x'
      ? Number.parseInt(entity.slice(2), 16)
      : Number.parseInt(entity.slice(1), 10)
    return code <= 0x10ffff ? String.fromCodePoint(code) : match
  })
}

export function releaseNotesToText(notes: ReleaseNotes, maxLength = 600): string {
  const html = typeof notes === 'string'
    ? notes
    : (notes ?? []).map(({ note }) => note ?? '').join('\n')
  const text = decodeEntities(html
    .replace(/<li[^>]*>\s*(?:<p[^>]*>)?/gi, '\n• ')
    .replace(/<br\s*\/?>|<\/(?:p|div|h[1-6]|li|ul|ol|pre|blockquote|tr)>/gi, '\n')
    .replace(/<[^>]*>/g, ''))
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text
}

export function describeUpdateError(error: unknown): UpdateErrorDescription {
  const text = error instanceof Error ? error.message : String(error)
  const { code, statusCode } = (typeof error === 'object' && error !== null ? error : {}) as {
    code?: unknown
    statusCode?: unknown
  }
  const detail = `错误信息：${text.split('\n')[0].trim().slice(0, 300) || '未知错误'}`
  const explain = (message: string) => ({ message, detail })

  if (NETWORK_ERROR.test(text)) return explain('无法连接到 GitHub，请检查网络或代理设置后重试。')
  if (code === 'ERR_CHECKSUM_MISMATCH' || /checksum mismatch/i.test(text)) {
    return explain('下载的安装包未通过完整性校验，已停止更新。')
  }
  if (code === 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND') {
    return explain('最新发布版本缺少在线更新描述文件（latest.yml），请前往发布页面手动下载。')
  }
  if (code === 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND' || code === 'ERR_UPDATER_NO_PUBLISHED_VERSIONS') {
    return explain('GitHub 上暂未找到已发布的正式版本。')
  }
  if (statusCode === 403 || statusCode === 429) return explain('GitHub 暂时限制了访问，请稍后再试。')
  if (code === 'ENOSPC') return explain('磁盘空间不足，无法保存更新安装包。')
  return explain('更新服务暂时不可用，请稍后再试。')
}
