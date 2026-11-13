import { describe, expect, it } from 'vitest'
import { prepareFrontMatter, restoreFrontMatter } from '../src/front-matter'
import { normalizeMathDelimiters } from '../src/markdown'

const document = '---\ntitle: 周报\ntags: [a, b]\n---\n\n# 标题\n\n正文 \\(x\\)\n'

describe('YAML front matter', () => {
  it('在编辑器中以 frontmatter 代码块呈现，并能原样还原', () => {
    const prepared = prepareFrontMatter(document)
    expect(prepared).toBe('```frontmatter\ntitle: 周报\ntags: [a, b]\n```\n\n# 标题\n\n正文 \\(x\\)\n')
    expect(restoreFrontMatter(prepared)).toBe(document)
  })

  it('还原 Milkdown 序列化后的代码块，并避开内容中的反引号', () => {
    expect(restoreFrontMatter('```frontmatter\ntitle: 周报\n```\n\n# 标题\n')).toBe('---\ntitle: 周报\n---\n\n# 标题\n')
    const withFence = '---\nnote: |\n  ```js\n  x\n  ```\n---\n正文'
    const prepared = prepareFrontMatter(withFence)
    expect(prepared.startsWith('````frontmatter\n')).toBe(true)
    expect(restoreFrontMatter(prepared)).toBe(withFence)
  })

  it('只处理文档开头的 front matter，数学分隔符转换不会改动其中内容', () => {
    expect(prepareFrontMatter('# 标题\n\n---\n\n正文\n---\n')).toBe('# 标题\n\n---\n\n正文\n---\n')
    expect(restoreFrontMatter('# 标题\n\n```frontmatter\na: 1\n```\n')).toBe('# 标题\n\n```frontmatter\na: 1\n```\n')
    const yaml = '---\nformula: \\(a+b\\)\n---\n正文 \\(x\\)'
    expect(normalizeMathDelimiters(prepareFrontMatter(yaml))).toBe('```frontmatter\nformula: \\(a+b\\)\n```\n正文 $x$')
  })
})
