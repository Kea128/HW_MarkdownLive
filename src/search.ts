export interface SearchQuery {
  text: string
  caseSensitive: boolean
  wholeWord: boolean
  regex: boolean
}

export interface SearchMatch {
  start: number
  end: number
}

export interface SearchResult {
  count: number
  /** Index of the highlighted match, or -1. */
  current: number
  error?: string
}

/** Enough to show "10000+" without building a decoration for every character of a huge document. */
export const MAX_MATCHES = 10_000

export const EMPTY_QUERY: SearchQuery = { text: '', caseSensitive: false, wholeWord: false, regex: false }

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** A global pattern for the query, `null` when there is nothing to find, or an error message for a bad expression. */
export function compileQuery(query: SearchQuery): RegExp | string | null {
  if (!query.text) return null
  let source = query.regex ? query.text : escapeRegExp(query.text)
  // Unicode mode is only needed for the letter classes; it would reject loose escapes such as `\-` in user patterns.
  if (query.wholeWord) source = `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`
  try {
    return new RegExp(source, `g${query.wholeWord ? 'u' : ''}${query.caseSensitive ? '' : 'i'}`)
  } catch {
    return '正则表达式无效'
  }
}

export function findMatches(text: string, pattern: RegExp, limit = MAX_MATCHES): SearchMatch[] {
  const matches: SearchMatch[] = []
  pattern.lastIndex = 0
  for (let match = pattern.exec(text); match && matches.length < limit; match = pattern.exec(text)) {
    // Patterns such as `^` or `a*` can match nothing; stepping past them keeps the loop finite.
    if (match[0].length === 0) {
      pattern.lastIndex += 1
      continue
    }
    matches.push({ start: match.index, end: match.index + match[0].length })
  }
  return matches
}

function expand(match: RegExpExecArray, template: string): string {
  return template.replace(/\$(\$|&|\d{1,2}|<([^>]+)>)/g, (whole, token: string, name?: string) => {
    if (token === '$') return '$'
    if (token === '&') return match[0]
    if (name !== undefined) return match.groups?.[name] ?? ''
    const index = Number(token)
    return index > 0 && index < match.length ? match[index] ?? '' : whole
  })
}

/** The text that replaces the match at `start`; regular expressions may use `$1`, `$<name>` and `$&`. */
export function replacementAt(text: string, start: number, pattern: RegExp, query: SearchQuery, replacement: string): string {
  if (!query.regex) return replacement
  const sticky = new RegExp(pattern.source, pattern.flags.replace('g', '') + 'y')
  sticky.lastIndex = start
  const match = sticky.exec(text)
  return match ? expand(match, replacement) : replacement
}

/** Replaces every match at once, so a single undo restores the text. */
export function replaceEvery(text: string, matches: SearchMatch[], pattern: RegExp, query: SearchQuery, replacement: string): string {
  let result = ''
  let last = 0
  for (const match of matches) {
    result += text.slice(last, match.start) + replacementAt(text, match.start, pattern, query, replacement)
    last = match.end
  }
  return result + text.slice(last)
}

/** The first match at or after `offset`, wrapping to the first one. */
export function matchAfter(matches: SearchMatch[], offset: number): number {
  if (!matches.length) return -1
  const index = matches.findIndex((match) => match.start >= offset)
  return index === -1 ? 0 : index
}

export function describeResult(result: SearchResult): string {
  if (result.error) return result.error
  if (!result.count) return '无结果'
  const total = result.count >= MAX_MATCHES ? `${MAX_MATCHES}+` : String(result.count)
  return `${result.current + 1}/${total}`
}
