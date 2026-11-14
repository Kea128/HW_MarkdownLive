export interface OutlineItem {
  level: number
  text: string
  /** 1-based source line of the heading. */
  line: number
  /** Offset of that line in the source. */
  offset: number
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/
// Lines that open another kind of block cannot be the text of a setext heading.
const OTHER_BLOCK = /^ {0,3}(?:[-*+>|<]|\d+[.)](?:\s|$))/

/** A heading as the reader sees it, without inline Markdown. */
export function headingText(markdown: string): string {
  return markdown
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/(\*\*|__|~~|`|\*|_)(.+?)\1/g, '$2')
    .replace(/\\([!-/:-@[-`{-~])/g, '$1')
    .trim()
}

/**
 * ATX and setext headings in document order. Lines inside front matter, fenced code and `$$` math are skipped:
 * a `# comment` in a shell example is not a heading.
 */
export function markdownOutline(markdown: string): OutlineItem[] {
  const lines = markdown.split('\n')
  const items: OutlineItem[] = []
  let offset = 0
  let first = 0
  if (/^---[ \t]*$/.test(lines[0] ?? '')) {
    const close = lines.findIndex((line, index) => index > 0 && /^(?:---|\.\.\.)[ \t]*$/.test(line))
    if (close > 0) {
      first = close + 1
      for (let index = 0; index < first; index += 1) offset += lines[index].length + 1
    }
  }
  let fence: { marker: string; length: number } | null = null
  let math = false
  let paragraph: { text: string; line: number; offset: number } | null = null

  for (let index = first; index < lines.length; index += 1) {
    const line = lines[index]
    const lineOffset = offset
    offset += line.length + 1
    const fenceMarker = FENCE.exec(line)?.[1]
    if (fence) {
      if (fenceMarker && fenceMarker[0] === fence.marker && fenceMarker.length >= fence.length && !/[^`~\s]/.test(line)) fence = null
      continue
    }
    if (math) {
      if (line.trimEnd().endsWith('$$')) math = false
      continue
    }
    if (fenceMarker) {
      fence = { marker: fenceMarker[0], length: fenceMarker.length }
      paragraph = null
      continue
    }
    if (/^ {0,3}\$\$/.test(line)) {
      const rest = line.trim().slice(2)
      if (!rest.endsWith('$$')) math = true
      paragraph = null
      continue
    }
    const atx = ATX.exec(line)
    if (atx) {
      const text = headingText(atx[2] ?? '')
      if (text) items.push({ level: atx[1].length, text, line: index + 1, offset: lineOffset })
      paragraph = null
      continue
    }
    const setext = SETEXT.exec(line)
    if (setext && paragraph) {
      const text = headingText(paragraph.text)
      if (text) items.push({ level: setext[1].startsWith('=') ? 1 : 2, text, line: paragraph.line, offset: paragraph.offset })
      paragraph = null
      continue
    }
    if (!line.trim() || OTHER_BLOCK.test(line) || (!paragraph && /^(?: {4}|\t)/.test(line))) {
      paragraph = null
      continue
    }
    if (paragraph) paragraph.text += ` ${line.trim()}`
    else paragraph = { text: line.trim(), line: index + 1, offset: lineOffset }
  }
  return items
}
