import { describe, expect, it } from 'vitest'
import { headingText, markdownOutline } from '../src/outline'

describe('文档大纲', () => {
  it('跳过 front matter、代码块与公式块，识别 setext 标题', () => {
    const markdown = [
      '---', 'title: 示例', '# 不是标题', '---', // 1-4
      '# 第一章 **重点**', '', // 5-6
      '```bash', '# 安装依赖', '```', '', // 7-10
      '~~~~', '# 还在代码里', '```', '~~~~', '', // 11-15
      '$$', '# 公式里', '$$', '', // 16-19
      'Setext 一级', '===', '', // 20-22
      '两行的', '段落标题', '---', '', // 23-26
      '- 列表项', '---', '', // 27-29
      '## 学习C# ##', '#　全角空格', '#没有空格', '  ### 缩进两格', '    # 代码缩进', '#', // 30-35
    ].join('\n')
    expect(markdownOutline(markdown).map(({ level, text, line }) => [level, text, line])).toEqual([
      [1, '第一章 重点', 5],
      [1, 'Setext 一级', 20],
      [2, '两行的 段落标题', 23],
      [2, '学习C#', 30],
      [3, '缩进两格', 33],
    ])
    const [first] = markdownOutline(markdown)
    expect(markdown.slice(first.offset, first.offset + 5)).toBe('# 第一章')
  })

  it('标题文字去掉行内 Markdown', () => {
    expect(headingText('[链接](https://a.b) 与 `代码` 和 ~~删除~~ \\*星号')).toBe('链接 与 代码 和 删除 *星号')
    expect(headingText('<span>HTML</span> ![图](a.png)')).toBe('HTML 图')
  })
})
