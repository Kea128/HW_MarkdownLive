import { describe, expect, it } from 'vitest'
import {
  getDocumentStats, insertMarkdown, insertMarkdownBlock, setMarkdownHeading,
} from '../src/utils'

describe('文档工具', () => {
  it('统计中英文、字符和行数', () => {
    expect(getDocumentStats('你好 hello world\n第二行')).toEqual({
      characters: 18,
      words: 7,
      lines: 2,
      readingMinutes: 1,
    })
  })

  it('包装选区并返回新光标位置', () => {
    expect(insertMarkdown('abc', 1, 2, '**')).toEqual({
      value: 'a**b**c',
      selectionStart: 3,
      selectionEnd: 4,
    })
  })

  it('设置完整标题层级并可恢复正文', () => {
    expect(setMarkdownHeading('标题', 0, 0, 1).value).toBe('# 标题')
    expect(setMarkdownHeading('## 标题', 3, 3, 6).value).toBe('###### 标题')
    expect(setMarkdownHeading('### 标题', 4, 4, 0).value).toBe('标题')
  })

  it('插入独立块级公式并与正文留出空行', () => {
    expect(insertMarkdownBlock('前文\n后文', 3, 3, '$$\n', '\n$$', 'E = mc^2').value)
      .toBe('前文\n\n$$\nE = mc^2\n$$\n\n后文')
  })
})
