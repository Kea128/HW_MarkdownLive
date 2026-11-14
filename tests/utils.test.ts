import { describe, expect, it } from 'vitest'
import {
  getDocumentStats, indentLines, insertMarkdown, insertMarkdownBlock, setMarkdownHeading, toggleLinePrefix,
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

  it('字数不计链接地址与 HTML，日文逐字、带重音的单词按一个词统计', () => {
    expect(getDocumentStats('![截图](assets/image-20261114-112233.png) こんにちは café naïve').words).toBe(9)
    expect(getDocumentStats('<span class="x">你好</span>\n\n').lines).toBe(3)
  })

  it('加粗不包住双击时一起选中的空格；标题跳过空行和以行首结束的选区', () => {
    expect(insertMarkdown('word next', 0, 5, '**')).toEqual({ value: '**word** next', selectionStart: 2, selectionEnd: 6 })
    expect(insertMarkdown('a   b', 1, 4, '**').value).toBe('a   **文本**b')
    expect(setMarkdownHeading('\nabc', 0, 0, 2).value).toBe('## \nabc')
    expect(setMarkdownHeading('a\nb', 0, 2, 1).value).toBe('# a\nb')
    expect(setMarkdownHeading('a\n\nb', 0, 4, 2).value).toBe('## a\n\n## b')
    expect(setMarkdownHeading('', 0, 0, 3).value).toBe('### ')
  })

  it('列表、任务与引用作用于选中的每一行，可替换已有列表符号，再按一次取消', () => {
    expect(toggleLinePrefix('hello world', 5, 5, 'bullet', '列表项')).toEqual({
      value: '- hello world', selectionStart: 7, selectionEnd: 7,
    })
    expect(toggleLinePrefix('a\n\nb\nc', 0, 6, 'ordered', '列表项').value).toBe('1. a\n\n2. b\n3. c')
    expect(toggleLinePrefix('- a\n- b', 0, 7, 'bullet', '列表项').value).toBe('a\nb')
    expect(toggleLinePrefix('- a\n1. b', 0, 8, 'task', '任务').value).toBe('- [ ] a\n- [ ] b')
    expect(toggleLinePrefix('  - a', 4, 4, 'quote', '引用').value).toBe('  > - a')
    expect(toggleLinePrefix('a\n\nb', 2, 2, 'quote', '引用')).toEqual({ value: 'a\n> 引用\nb', selectionStart: 4, selectionEnd: 6 })
  })

  it('Tab 缩进选中的每一行，Shift+Tab 最多移除两个空格', () => {
    expect(indentLines('ab', 1, 1, false)).toEqual({ value: 'a  b', selectionStart: 3, selectionEnd: 3 })
    expect(indentLines('a\nb', 0, 3, false)).toEqual({ value: '  a\n  b', selectionStart: 0, selectionEnd: 7 })
    expect(indentLines('   a\n\tb\nc', 0, 9, true).value).toBe(' a\nb\nc')
    expect(indentLines('  a', 3, 3, true)).toEqual({ value: 'a', selectionStart: 1, selectionEnd: 1 })
  })
})
