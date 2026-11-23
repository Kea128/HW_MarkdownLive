import { describe, expect, it } from 'vitest'
import {
  compileQuery, describeResult, EMPTY_QUERY, findMatches, matchAfter, MAX_MATCHES, replaceEvery, replacementAt,
  type SearchQuery,
} from '../src/search'

const query = (text: string, options: Partial<SearchQuery> = {}): SearchQuery => ({ ...EMPTY_QUERY, text, ...options })
const find = (text: string, search: SearchQuery) => {
  const pattern = compileQuery(search)
  if (!(pattern instanceof RegExp)) throw new Error(`no pattern: ${String(pattern)}`)
  return findMatches(text, pattern).map(({ start, end }) => text.slice(start, end))
}

describe('查找引擎', () => {
  it('默认按字面量、忽略大小写查找，特殊字符不当作正则', () => {
    expect(compileQuery(EMPTY_QUERY)).toBeNull()
    expect(find('Markdown markdown MARKDOWN', query('markdown'))).toEqual(['Markdown', 'markdown', 'MARKDOWN'])
    expect(find('a.b axb a.b', query('a.b'))).toEqual(['a.b', 'a.b'])
    expect(find('$$ x $$ (1+2)', query('$$'))).toEqual(['$$', '$$'])
    expect(find('(1+2) [x]', query('(1+2)'))).toEqual(['(1+2)'])
  })

  it('区分大小写与全字匹配，中文和下划线算作单词的一部分', () => {
    expect(find('Markdown markdown', query('markdown', { caseSensitive: true }))).toEqual(['markdown'])
    expect(find('cat concat cat_1 cat.', query('cat', { wholeWord: true }))).toEqual(['cat', 'cat'])
    expect(find('周报 周报表 周报。', query('周报', { wholeWord: true }))).toEqual(['周报', '周报'])
  })

  it('正则模式支持分组，无效表达式给出提示，空匹配不会死循环', () => {
    expect(find('v1.2 v10.3', query('v(\\d+)\\.(\\d)', { regex: true }))).toEqual(['v1.2', 'v10.3'])
    expect(compileQuery(query('a(', { regex: true }))).toBe('正则表达式无效')
    expect(find('ab\ncd', query('^', { regex: true }))).toEqual([])
    expect(find('aaa', query('a*', { regex: true }))).toEqual(['aaa'])
    expect(find('foo-bar foo', query('foo\\-bar', { regex: true }))).toEqual(['foo-bar'])
  })

  it('结果数量有上限，计数文字显示当前位置', () => {
    const pattern = compileQuery(query('a')) as RegExp
    expect(findMatches('a'.repeat(MAX_MATCHES + 5), pattern)).toHaveLength(MAX_MATCHES)
    expect(describeResult({ count: 3, current: 1 })).toBe('2/3')
    expect(describeResult({ count: MAX_MATCHES, current: 0 })).toBe(`1/${MAX_MATCHES}+`)
    expect(describeResult({ count: 0, current: -1 })).toBe('无结果')
    expect(describeResult({ count: 0, current: -1, error: '正则表达式无效' })).toBe('正则表达式无效')
  })

  it('替换文本：字面量原样插入，正则可引用分组', () => {
    const text = 'v1.2 和 v10.3'
    const literal = query('v1.2')
    const literalPattern = compileQuery(literal) as RegExp
    expect(replacementAt(text, 0, literalPattern, literal, '$&-新')).toBe('$&-新')
    const regex = query('v(?<major>\\d+)\\.(\\d)', { regex: true })
    const pattern = compileQuery(regex) as RegExp
    expect(replacementAt(text, 7, pattern, regex, '$2.$1')).toBe('3.10')
    expect(replacementAt(text, 0, pattern, regex, '[$&] $<major> $$')).toBe('[v1.2] 1 $')
    expect(replaceEvery(text, findMatches(text, pattern), pattern, regex, 'V$<major>')).toBe('V1 和 V10')
  })

  it('全字匹配替换时仍按原文判断单词边界', () => {
    const search = query('cat', { wholeWord: true, regex: true })
    const pattern = compileQuery(search) as RegExp
    const text = 'cat concat cat'
    expect(replaceEvery(text, findMatches(text, pattern), pattern, search, 'dog')).toBe('dog concat dog')
  })

  it('从光标位置找下一个匹配，越过末尾回到第一个', () => {
    const matches = [{ start: 2, end: 4 }, { start: 8, end: 10 }]
    expect(matchAfter(matches, 0)).toBe(0)
    expect(matchAfter(matches, 2)).toBe(0)
    expect(matchAfter(matches, 3)).toBe(1)
    expect(matchAfter(matches, 11)).toBe(0)
    expect(matchAfter([], 0)).toBe(-1)
  })
})
