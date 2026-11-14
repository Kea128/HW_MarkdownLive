import { describe, expect, it } from 'vitest'
import { normalizeMathDelimiters } from '../src/markdown'

describe('数学分隔符兼容', () => {
  it('转换 LaTeX 行内与块级分隔符', () => {
    expect(normalizeMathDelimiters('行内 \\(x^2\\)\n\n\\[\ny=1\n\\]'))
      .toBe('行内 $x^2$\n\n$$\ny=1\n$$')
  })

  it('保留转义字符、行内代码与围栏代码', () => {
    const markdown = [
      '\\\\(literal\\\\)',
      '`\\(inline\\)`',
      '```tex',
      '\\[block\\]',
      '```',
    ].join('\n')
    expect(normalizeMathDelimiters(markdown)).toBe(markdown)
  })

  it('只转换同一段落内成对的分隔符：编辑器转义的方括号与普通文字保持原样', () => {
    expect(normalizeMathDelimiters('see \\[1] and \\[2]')).toBe('see \\[1] and \\[2]')
    expect(normalizeMathDelimiters('Press \\[Enter\\] to continue')).toBe('Press \\[Enter\\] to continue')
    expect(normalizeMathDelimiters('参考 \\[1\\]')).toBe('参考 \\[1\\]')
    expect(normalizeMathDelimiters('\\[ \\frac{a}{b} \\]')).toBe('$$ \\frac{a}{b} $$')
    expect(normalizeMathDelimiters('跨段 \\(a\n\nb\\)')).toBe('跨段 \\(a\n\nb\\)')
    const unmatched = ['开头 \\[x', '', '```js', 'const re = /[a-z\\]/', '```'].join('\n')
    expect(normalizeMathDelimiters(unmatched)).toBe(unmatched)
  })
})
