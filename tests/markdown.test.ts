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
})
