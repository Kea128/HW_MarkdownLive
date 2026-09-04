/**
 * Normalize LaTeX/MathJax delimiters to the `$` syntax used by Markdown
 * editors such as Typora and Milkdown, while preserving code examples.
 */
export function normalizeMathDelimiters(markdown: string): string {
  let result = ''
  let index = 0
  let lineStart = true
  let fence: { marker: string; length: number } | null = null
  let fenceMarkerLine = false
  let inlineCodeLength = 0
  let mathClosing: ')' | ']' | null = null

  const backslashIsEscaped = (position: number) => {
    let preceding = 0
    for (let cursor = position - 1; cursor >= 0 && markdown[cursor] === '\\'; cursor -= 1) preceding += 1
    return preceding % 2 === 1
  }

  while (index < markdown.length) {
    if (lineStart && inlineCodeLength === 0 && mathClosing === null) {
      const line = markdown.slice(index).match(/^( {0,3})(`{3,}|~{3,})/)
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
    if (!fence && !fenceMarkerLine && mathClosing === null && character === '`') {
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
      const next = markdown[index + 1]
      if (mathClosing === null && (next === '(' || next === '[')) {
        mathClosing = next === '(' ? ')' : ']'
        result += next === '(' ? '$' : '$$'
        index += 2
        lineStart = false
        continue
      }
      if (mathClosing !== null && next === mathClosing) {
        result += mathClosing === ')' ? '$' : '$$'
        mathClosing = null
        index += 2
        lineStart = false
        continue
      }
    }

    result += character
    index += 1
    lineStart = character === '\n'
    if (lineStart) fenceMarkerLine = false
  }

  return result
}
