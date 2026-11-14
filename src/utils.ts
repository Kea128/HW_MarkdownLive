export interface DocumentStats {
  characters: number
  words: number
  lines: number
  readingMinutes: number
}

export interface TextEdit {
  value: string
  selectionStart: number
  selectionEnd: number
}

const CJK = '\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}'
const LETTER = `(?:(?![${CJK}])[\\p{L}\\p{N}\\p{M}])`
// Chinese and Japanese are counted per character, other scripts per word (Unicode-aware, so café counts once).
const WORDS = new RegExp(`[${CJK}]|${LETTER}+(?:['’-]${LETTER}+)*`, 'gu')

export function getDocumentStats(markdown: string): DocumentStats {
  // Link targets, image paths and HTML tags are not words the reader sees.
  const text = markdown
    .replace(/(!?\[[^\]\n]*\])\([^)\n]*\)/g, '$1')
    .replace(/<[^>\n]+>/g, ' ')
  let words = 0
  for (const _ of text.matchAll(WORDS)) words += 1
  let lines = 1
  for (let index = markdown.indexOf('\n'); index !== -1; index = markdown.indexOf('\n', index + 1)) lines += 1

  return {
    characters: markdown.length,
    words,
    lines,
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
): TextEdit {
  // A double-click also selects the trailing space, and `**word **` is not bold in CommonMark.
  if (suffix && selectionEnd > selectionStart) {
    while (selectionStart < selectionEnd && /\s/.test(value[selectionStart])) selectionStart += 1
    while (selectionEnd > selectionStart && /\s/.test(value[selectionEnd - 1])) selectionEnd -= 1
  }
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

/** The whole lines a selection touches; a selection ending at the start of a line (Shift+Down) leaves that line out. */
export function selectedLines(value: string, selectionStart: number, selectionEnd: number) {
  const end = selectionEnd > selectionStart && value[selectionEnd - 1] === '\n' ? selectionEnd - 1 : selectionEnd
  const start = selectionStart === 0 ? 0 : value.lastIndexOf('\n', selectionStart - 1) + 1
  const nextBreak = value.indexOf('\n', end)
  return { start, end: nextBreak === -1 ? value.length : nextBreak }
}

function replaceLines(
  value: string, selectionStart: number, selectionEnd: number,
  transform: (lines: string[]) => string[],
): TextEdit {
  const range = selectedLines(value, selectionStart, selectionEnd)
  const lines = value.slice(range.start, range.end).split('\n')
  const replacement = transform(lines).join('\n')
  const single = lines.length === 1
  // A caret stays in place relative to the text; a multi-line selection keeps covering the changed lines.
  const shift = replacement.length - (range.end - range.start)
  return {
    value: value.slice(0, range.start) + replacement + value.slice(range.end),
    selectionStart: single && selectionStart === selectionEnd
      ? Math.max(range.start, Math.min(selectionStart + shift, range.start + replacement.length))
      : range.start,
    selectionEnd: single && selectionStart === selectionEnd
      ? Math.max(range.start, Math.min(selectionEnd + shift, range.start + replacement.length))
      : range.start + replacement.length,
  }
}

export function setMarkdownHeading(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  level: number,
): TextEdit {
  const prefix = level > 0 ? `${'#'.repeat(Math.min(6, level))} ` : ''
  const range = selectedLines(value, selectionStart, selectionEnd)
  const multiple = value.slice(range.start, range.end).includes('\n')
  const replacement = value.slice(range.start, range.end)
    .split('\n')
    .map((line) => multiple && !line.trim() ? line : `${prefix}${line.replace(/^ {0,3}#{1,6}(?:[ \t]+|$)/, '')}`)
    .join('\n')

  return {
    value: value.slice(0, range.start) + replacement + value.slice(range.end),
    selectionStart: Math.min(range.start + prefix.length, range.start + replacement.length),
    selectionEnd: range.start + replacement.length,
  }
}

export type LinePrefix = 'bullet' | 'ordered' | 'task' | 'quote'

const LIST_MARKER = /^(\s*)(?:[-*+][ \t]+\[[ xX]\][ \t]+|[-*+][ \t]+|\d+[.)][ \t]+)/
const PREFIX_PATTERNS: Record<LinePrefix, RegExp> = {
  bullet: /^(\s*)[-*+][ \t]+(?!\[[ xX]\][ \t])/,
  ordered: /^(\s*)\d+[.)][ \t]+/,
  task: /^(\s*)[-*+][ \t]+\[[ xX]\][ \t]+/,
  quote: /^(\s*)>[ \t]?/,
}

/**
 * Lists, tasks and quotes apply to every selected line at its start, replacing another list marker, and are
 * removed again when every selected line already has them. An empty line gets the prefix and a placeholder.
 */
export function toggleLinePrefix(
  value: string, selectionStart: number, selectionEnd: number, kind: LinePrefix, placeholder: string,
): TextEdit {
  const range = selectedLines(value, selectionStart, selectionEnd)
  const current = value.slice(range.start, range.end)
  const marker = (index: number) => ({ bullet: '- ', ordered: `${index + 1}. `, task: '- [ ] ', quote: '> ' })[kind]
  if (!current.trim()) {
    const text = `${marker(0)}${placeholder}`
    return {
      value: value.slice(0, range.start) + text + value.slice(range.end),
      selectionStart: range.start + marker(0).length,
      selectionEnd: range.start + text.length,
    }
  }
  const pattern = PREFIX_PATTERNS[kind]
  const content = current.split('\n').filter((line) => line.trim())
  const remove = content.every((line) => pattern.test(line))
  return replaceLines(value, selectionStart, selectionEnd, (lines) => {
    let index = 0
    return lines.map((line) => {
      if (!line.trim()) return line
      if (remove) return line.replace(pattern, '$1')
      const stripped = kind === 'quote' ? line : line.replace(LIST_MARKER, '$1')
      const indent = /^\s*/.exec(stripped)?.[0] ?? ''
      return `${indent}${marker(index++)}${stripped.slice(indent.length)}`
    })
  })
}

/** Tab indents every selected line by two spaces (or inserts them at the caret); Shift+Tab removes up to two. */
export function indentLines(value: string, selectionStart: number, selectionEnd: number, outdent: boolean): TextEdit {
  const range = selectedLines(value, selectionStart, selectionEnd)
  if (!outdent && !value.slice(range.start, range.end).includes('\n') && selectionStart === selectionEnd) {
    return insertMarkdown(value, selectionStart, selectionEnd, '  ', '', '')
  }
  return replaceLines(value, selectionStart, selectionEnd, (lines) => lines.map((line) => {
    if (!outdent) return line ? `  ${line}` : line
    return line.replace(/^(?: {1,2}|\t)/, '')
  }))
}

export function insertMarkdownBlock(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  prefix: string,
  suffix: string,
  placeholder: string,
): TextEdit {
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
