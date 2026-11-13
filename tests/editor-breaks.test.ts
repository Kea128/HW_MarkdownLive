import { describe, expect, it } from 'vitest'
import { removeEmptyLineMarkers, type MarkdownNode } from '../src/editor-breaks'

const html = (value: string): MarkdownNode => ({ type: 'html', value })
const text = (value: string): MarkdownNode => ({ type: 'text', value })

describe('<br> 换行', () => {
  it('只移除表示空行的单独 <br />，保留正文和表格中的 <br>', () => {
    const tree: MarkdownNode = {
      type: 'root',
      children: [
        { type: 'paragraph', children: [html('<br />')] },
        { type: 'paragraph', children: [text('段落一'), html('<br>'), text('段落二')] },
        {
          type: 'table',
          children: [{ type: 'tableRow', children: [{ type: 'tableCell', children: [text('第一行'), html('<br/>'), text('换行')] }] }],
        },
        { type: 'paragraph', children: [html('<span>')] },
      ],
    }
    removeEmptyLineMarkers(tree)
    expect(tree.children?.[0].children).toEqual([])
    expect(tree.children?.[1].children).toEqual([text('段落一'), html('<br>'), text('段落二')])
    expect(tree.children?.[2].children?.[0].children?.[0].children?.[1]).toEqual(html('<br/>'))
    expect(tree.children?.[3].children).toEqual([html('<span>')])
  })
})
