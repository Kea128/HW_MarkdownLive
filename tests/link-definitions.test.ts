import remarkParse from 'remark-parse'
import remarkStringify from 'remark-stringify'
import { unified } from 'unified'
import { describe, expect, it } from 'vitest'
import { inlineReferences, type LinkNode } from '../src/link-definitions'

const roundTrip = (markdown: string) => {
  const processor = unified().use(remarkParse).use(remarkStringify)
  const tree = processor.parse(markdown) as unknown as LinkNode
  inlineReferences(tree, markdown)
  return processor.stringify(tree as never).trim()
}

describe('链接定义', () => {
  it('引用改为行内链接，定义和注释行原样保留', () => {
    const markdown = [
      '[//]: # (内部备注)',
      '',
      '见 [文档][Docs] 与 ![图][logo]。',
      '',
      '[docs]: https://example.com/docs "说明"',
      '[logo]: ./logo.png',
    ].join('\n')
    const output = roundTrip(markdown)
    expect(output).toContain('[//]: # (内部备注)')
    expect(output).toContain('[文档](https://example.com/docs "说明")')
    expect(output).toContain('![图](./logo.png)')
    expect(output).toContain('[docs]: https://example.com/docs "说明"')
    expect(output).toContain('[logo]: ./logo.png')
  })

  it('没有源文本时按字段重建定义', () => {
    const tree: LinkNode = {
      type: 'root',
      children: [{ type: 'definition', identifier: 'a', label: 'A', url: 'https://a.b', title: '标题' }],
    }
    inlineReferences(tree)
    expect(tree.children).toEqual([{ type: 'paragraph', children: [{ type: 'html', value: '[A]: https://a.b "标题"' }] }])
  })
})
