const BLANK_LINE = /\n[ \t]*\n/g
const DISPLAY_MATH = /\n|[\\^_={}]/

/**
 * Normalize LaTeX/MathJax delimiters to the `$` syntax used by Markdown
 * editors such as Typora and Milkdown, while preserving code examples.
 *
 * Only complete pairs within one paragraph are converted: the editor writes a typed `[` as `\[`, and `\[Enter\]`
 * in prose is an escaped bracket, so `\[…\]` must also span lines or contain something that reads as math.
 */
export function normalizeMathDelimiters(markdown: string): string {
  let result = ''
  let index = 0
  let lineStart = true
  let fence: { marker: string; length: number } | null = null
  let fenceMarkerLine = false
  let inlineCodeLength = 0

  const backslashIsEscaped = (position: number) => {
    let preceding = 0
    for (let cursor = position - 1; cursor >= 0 && markdown[cursor] === '\\'; cursor -= 1) preceding += 1
    return preceding % 2 === 1
  }

  const closingAt = (from: number, closer: string) => {
    BLANK_LINE.lastIndex = from
    const end = BLANK_LINE.exec(markdown)?.index ?? markdown.length
    for (let cursor = markdown.indexOf(`\\${closer}`, from); cursor !== -1 && cursor < end; cursor = markdown.indexOf(`\\${closer}`, cursor + 1)) {
      if (!backslashIsEscaped(cursor)) return cursor
    }
    return -1
  }

  while (index < markdown.length) {
    if (lineStart && inlineCodeLength === 0) {
      const line = markdown.slice(index, index + 64).match(/^( {0,3})(`{3,}|~{3,})/)
      if (line) {
        fenceMarkerLine = true
        const marker = line[2][0]
        if (!fence) {
          fence = { marker, length: line[2].length }
        } else if (fence.marker === marker && line[2].length >= fence.length) {
          fence = null
        }
      }
    }

    const character = markdown[index]
    if (!fence && !fenceMarkerLine && character === '`') {
      let runLength = 1
      while (markdown[index + runLength] === '`') runLength += 1
      if (inlineCodeLength === 0) inlineCodeLength = runLength
      else if (inlineCodeLength === runLength) inlineCodeLength = 0
      result += markdown.slice(index, index + runLength)
      index += runLength
      lineStart = false
      continue
    }

    if (!fence && !fenceMarkerLine && inlineCodeLength === 0 && character === '\\' && !backslashIsEscaped(index)) {
      const opener = markdown[index + 1]
      if (opener === '(' || opener === '[') {
        const close = closingAt(index + 2, opener === '(' ? ')' : ']')
        const content = close === -1 ? '' : markdown.slice(index + 2, close)
        if (content.trim() && (opener === '(' || DISPLAY_MATH.test(content))) {
          const delimiter = opener === '(' ? '$' : '$$'
          result += delimiter + content + delimiter
          index = close + 2
          lineStart = false
          continue
        }
      }
    }

    result += character
    index += 1
    lineStart = character === '\n'
    if (lineStart) fenceMarkerLine = false
  }

  return result
}
