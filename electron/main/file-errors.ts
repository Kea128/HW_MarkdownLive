const REASONS: Record<string, string> = {
  ENOENT: '文件不存在或已被移动',
  ENOTDIR: '路径无效',
  EISDIR: '这是一个文件夹',
  EACCES: '没有访问权限',
  EPERM: '没有访问权限，或文件被设为只读',
  EBUSY: '文件正被其他程序占用',
  ENOSPC: '磁盘空间不足',
  EROFS: '磁盘为只读',
  ENAMETOOLONG: '文件路径过长',
  EMFILE: '打开的文件过多，请稍后重试',
  EFBIG: '文件过大',
  TOO_LARGE: '文件超过 20 MB，Inkdown 无法流畅编辑这么大的文档',
}

export const errorCode = (error: unknown): string | undefined => (error as { code?: unknown } | null)?.code as string | undefined

/** Node reports file errors in English with the path; the interface shows a short Chinese reason instead. */
export function describeFileError(error: unknown, action: string): string {
  const code = errorCode(error)
  const reason = (code && REASONS[code]) || (error instanceof Error ? error.message : String(error))
  return `无法${action}：${reason}`
}
