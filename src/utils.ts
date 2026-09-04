export type EditorMode = 'visual' | 'source'

export interface DocumentStats {
  characters: number
  words: number
  lines: number
  readingMinutes: number
}

export function getDocumentStats(markdown: string): DocumentStats {
  const normalized = markdown.trim()
  const latinWords = normalized.match(/[a-zA-Z0-9]+(?:['’-][a-zA-Z0-9]+)*/g)?.length ?? 0
  const cjkCharacters = normalized.match(/[\u3400-\u9fff\uf900-\ufaff]/g)?.length ?? 0
  const words = latinWords + cjkCharacters

  return {
    characters: markdown.length,
    words,
    lines: markdown.length === 0 ? 1 : markdown.split(/\r\n|\r|\n/).length,
    readingMinutes: Math.max(1, Math.ceil(words / 300)),
  }
}

export function insertMarkdown(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  prefix: string,
  suffix = prefix,
  placeholder = '文本',
) {
  const selected = value.slice(selectionStart, selectionEnd) || placeholder
  const nextValue =
    value.slice(0, selectionStart) + prefix + selected + suffix + value.slice(selectionEnd)
  const nextStart = selectionStart + prefix.length
  return {
    value: nextValue,
    selectionStart: nextStart,
    selectionEnd: nextStart + selected.length,
  }
}

export function setMarkdownHeading(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  level: number,
) {
  const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1
  const nextBreak = value.indexOf('\n', selectionEnd)
  const lineEnd = nextBreak === -1 ? value.length : nextBreak
  const prefix = level > 0 ? `${'#'.repeat(Math.min(6, level))} ` : ''
  const selectedLines = value.slice(lineStart, lineEnd)
  const replacement = selectedLines
    .split('\n')
    .map((line) => `${prefix}${line.replace(/^#{1,6}\s+/, '')}`)
    .join('\n')

  return {
    value: value.slice(0, lineStart) + replacement + value.slice(lineEnd),
    selectionStart: Math.min(lineStart + prefix.length, lineStart + replacement.length),
    selectionEnd: lineStart + replacement.length,
  }
}

export function insertMarkdownBlock(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  prefix: string,
  suffix: string,
  placeholder: string,
) {
  const selected = value.slice(selectionStart, selectionEnd) || placeholder
  const before = value.slice(0, selectionStart)
  const after = value.slice(selectionEnd)
  const leading = before.length === 0 || before.endsWith('\n\n')
    ? ''
    : before.endsWith('\n') ? '\n' : '\n\n'
  const trailing = after.length === 0 || after.startsWith('\n\n')
    ? ''
    : after.startsWith('\n') ? '\n' : '\n\n'
  const block = `${prefix}${selected}${suffix}`
  const blockStart = before.length + leading.length

  return {
    value: before + leading + block + trailing + after,
    selectionStart: blockStart + prefix.length,
    selectionEnd: blockStart + prefix.length + selected.length,
  }
}

