import { constants } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ImageFolderSetting, ImageSaveResult } from '../../src/contracts'
import { expandFolderTemplate, folderTemplate } from '../../src/image-folder'
import { isImagePath } from '../../src/image-source'
import { describeFileError } from './file-errors'
import { isInsideWorkspace } from './workspace'

const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/bmp': '.bmp',
  'image/svg+xml': '.svg',
  'image/avif': '.avif',
}
const MAX_IMAGE_BYTES = 64 * 1024 * 1024
const GENERIC_NAME = /^(?:image|img|clipboard|screenshot|untitled|blob|图片|截图)(?:[-_ ]?\d+)?$/i
// The editor writes `\]` in alt text and `\(` `\)` in destinations, so both allow backslash escapes.
const MARKDOWN_IMAGE = /(!\[(?:\\.|[^\]\\\n])*\]\(\s*)(<[^>\n]+>|(?:\\.|[^\s()\\]|\((?:\\.|[^\s()\\])*\))+)/g
const HTML_IMAGE = /(<img\b[^>]*?\bsrc\s*=\s*)("[^"]*"|'[^']*')/gi
const MARKDOWN_ESCAPE = /\\([!-/:-@[-`{-~])/g

export function imageFolder(documentPath: string, setting: ImageFolderSetting): string {
  const base = path.basename(documentPath, path.extname(documentPath))
  return path.resolve(path.dirname(documentPath), expandFolderTemplate(folderTemplate(setting), base))
}

export function imageTimestamp(date: Date): string {
  const pad = (value: number, size = 2) => String(value).padStart(size, '0')
  return `image-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
    + `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}${pad(date.getMilliseconds(), 3)}`
}

export function sanitizeFileName(name: string): string {
  return [...name].filter((char) => char >= ' ' && !'<>:"/\\|?*'.includes(char)).join('')
    .replace(/[. ]+$/, '').trim().slice(0, 80)
}

const forwardSlashes = (filePath: string) => filePath.split(path.sep).join('/')
const comparable = (filePath: string) => forwardSlashes(path.resolve(filePath)).toLowerCase()

function markdownLink(fromFolder: string, target: string): string {
  return forwardSlashes(path.relative(fromFolder, target))
}

async function writeUnique(folder: string, base: string, extension: string, write: (target: string) => Promise<void>) {
  for (let index = 0; index < 1000; index += 1) {
    const target = path.join(folder, `${index ? `${base}-${index}` : base}${extension}`)
    try {
      await write(target)
      return target
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
  throw new Error('无法生成不重复的图片文件名')
}

async function isImageFile(filePath: string): Promise<boolean> {
  try {
    const info = await stat(filePath)
    return info.isFile() && info.size <= MAX_IMAGE_BYTES
  } catch {
    return false
  }
}

/** An earlier copy of `source` in `folder`, so saving again after an interrupted relocation does not duplicate it. */
async function existingCopy(folder: string, base: string, extension: string, source: string): Promise<string | null> {
  const original = await readFile(source).catch(() => null)
  if (!original) return null
  for (let index = 0; index < 20; index += 1) {
    const candidate = path.join(folder, `${index ? `${base}-${index}` : base}${extension}`)
    const existing = await readFile(candidate).catch(() => null)
    if (!existing) return null
    if (existing.equals(original)) return candidate
  }
  return null
}

export interface SaveImageOptions {
  documentPath: string | null
  stagingDir: string
  folder: ImageFolderSetting
  now?: Date
}

/** Stores a pasted or dropped image next to the document, or in the staging folder while the document is untitled. */
export async function saveImage(input: unknown, options: SaveImageOptions): Promise<ImageSaveResult> {
  if (!input || typeof input !== 'object') return { ok: false, error: '图片数据无效' }
  const { name, type, data, sourcePath } = input as Record<string, unknown>
  const { documentPath, stagingDir, now = new Date() } = options
  const documentFolder = documentPath ? path.dirname(documentPath) : null
  const folder = documentPath ? imageFolder(documentPath, options.folder) : stagingDir
  const result = (target: string, linked = false): ImageSaveResult => ({
    ok: true,
    src: documentFolder ? markdownLink(documentFolder, target) : forwardSlashes(target),
    location: !documentFolder ? 'staged' : linked ? 'linked' : 'saved',
  })
  const baseName = (candidate: string) => {
    const base = sanitizeFileName(candidate)
    return !base || GENERIC_NAME.test(base) ? imageTimestamp(now) : base
  }
  try {
    if (typeof sourcePath === 'string' && sourcePath) {
      if (!path.isAbsolute(sourcePath) || !isImagePath(sourcePath)) return { ok: false, error: '只能插入图片文件' }
      if (!(await isImageFile(sourcePath))) return { ok: false, error: '图片文件不存在或超过 64 MB' }
      if (documentFolder && isInsideWorkspace(documentFolder, sourcePath)) return result(sourcePath, true)
      const extension = path.extname(sourcePath).toLowerCase()
      await mkdir(folder, { recursive: true })
      return result(await writeUnique(folder, baseName(path.basename(sourcePath, path.extname(sourcePath))), extension,
        (target) => copyFile(sourcePath, target, constants.COPYFILE_EXCL)))
    }
    const extension = typeof type === 'string' ? MIME_EXTENSIONS[type.toLowerCase()] : undefined
    if (!extension) return { ok: false, error: '不支持的图片格式' }
    if (!(data instanceof Uint8Array) || data.byteLength === 0 || data.byteLength > MAX_IMAGE_BYTES) {
      return { ok: false, error: '图片数据为空或超过 64 MB' }
    }
    await mkdir(folder, { recursive: true })
    return result(await writeUnique(folder, baseName(typeof name === 'string' ? name.replace(/\.[^.]*$/, '') : ''), extension,
      (target) => writeFile(target, data, { flag: 'wx' })))
  } catch (error) {
    return { ok: false, error: describeFileError(error, '保存图片') }
  }
}

export interface RelocateOptions {
  from: string | null
  to: string
  stagingDir: string
  folder: ImageFolderSetting
}

export interface RelocatedImages {
  content: string
  staged: string[]
  /** Images that could not be copied keep their old links. */
  failed: number
}

const safeDecode = (value: string) => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * Before writing a document to `to`, moves images staged while it was untitled into its image folder and copies
 * relative images that would no longer resolve after a Save As into another folder, rewriting their links.
 */
export async function relocateImages(content: string, options: RelocateOptions): Promise<RelocatedImages> {
  const toFolder = path.dirname(options.to)
  const fromFolder = options.from ? path.dirname(options.from) : null
  const movedFolder = fromFolder !== null && comparable(fromFolder) !== comparable(toFolder)
  const stagingPrefix = `${comparable(options.stagingDir)}/`
  const staged = new Set<string>()
  const links = new Map<string, string | null>()
  let failed = 0

  const relink = async (destination: string): Promise<string | null> => {
    const target = safeDecode(destination.trim().replace(MARKDOWN_ESCAPE, '$1'))
    if (!target || /^[a-z][a-z\d+.-]+:/i.test(target) || target.startsWith('//') || target.startsWith('#')) return null
    let source: string | null = null
    let fromStaging = false
    if (/^(?:[a-z]:[\\/]|\\\\)/i.test(target)) {
      fromStaging = comparable(target).startsWith(stagingPrefix)
      if (fromStaging) source = path.resolve(target)
    } else if (movedFolder && fromFolder && !/^[\\/]/.test(target)) {
      if (!(await isImageFile(path.resolve(toFolder, target)))) source = path.resolve(fromFolder, target)
    }
    if (!source || !isImagePath(source)) return null
    const key = comparable(source)
    if (links.has(key)) return links.get(key) ?? null
    let link: string | null = null
    if (await isImageFile(source)) {
      try {
        const folder = imageFolder(options.to, options.folder)
        await mkdir(folder, { recursive: true })
        const extension = path.extname(source)
        const base = path.basename(source, extension)
        const copied = await existingCopy(folder, base, extension, source)
          ?? await writeUnique(folder, base, extension, (file) => copyFile(source, file, constants.COPYFILE_EXCL))
        link = markdownLink(toFolder, copied)
        if (fromStaging) staged.add(source)
      } catch {
        failed += 1
      }
    }
    links.set(key, link)
    return link
  }

  const rewrite = async (text: string, pattern: RegExp, format: (link: string, original: string) => string) => {
    let output = ''
    let last = 0
    for (const match of text.matchAll(pattern)) {
      const [whole, prefix, destination] = match
      const start = match.index ?? 0
      const link = await relink(destination.replace(/^["'<]|[>"']$/g, ''))
      if (link === null) continue
      output += text.slice(last, start) + prefix + format(link, destination)
      last = start + whole.length
    }
    return output + text.slice(last)
  }

  let result = await rewrite(content, MARKDOWN_IMAGE, (link) => /[\s()<>]/.test(link) ? `<${link}>` : link)
  result = await rewrite(result, HTML_IMAGE, (link, original) => `${original[0]}${link}${original[0]}`)
  return { content: result, staged: [...staged], failed }
}

export async function removeStagedImages(files: string[]): Promise<void> {
  await Promise.all(files.map((file) => unlink(file).catch(() => undefined)))
}

/**
 * Staged images stay until a later start: text typed during the first save can still link them, and the next save
 * moves them again. Files older than `maxAge` that `keep` (the crash draft) does not mention are removed.
 */
export async function cleanStagedImages(stagingDir: string, keep: string, maxAge = 24 * 60 * 60 * 1000): Promise<void> {
  const names = await readdir(stagingDir).catch(() => [] as string[])
  const now = Date.now()
  await Promise.all(names.map(async (name) => {
    if (keep.includes(name)) return
    const file = path.join(stagingDir, name)
    const info = await stat(file).catch(() => null)
    if (info?.isFile() && now - info.mtimeMs > maxAge) await unlink(file).catch(() => undefined)
  }))
}
