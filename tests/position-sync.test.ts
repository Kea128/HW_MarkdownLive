import { Schema, type Node } from '@milkdown/kit/prose/model'
import { EditorState, TextSelection } from '@milkdown/kit/prose/state'
import { EditorView } from '@milkdown/kit/prose/view'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  blockPathAtLine, lineAtBlockPath, lineAtOffset, offsetAtLine, revealAnchor, sourceAnchor, sourceScrollTop,
  visualAnchor, type MarkdownBlock,
} from '../src/position-sync'
import { stubLayout } from './prose-fixture'

const markdown = [
  '# 标题', // 1
  '',
  '第一段', // 3
  '',
  '- 甲', // 5
  '- 乙', // 6
  '  - 乙一', // 7
  '',
  '```ts', // 9
  'const a = 1', // 10
  'const b = 2', // 11
  '```', // 12
  '',
  '[ref]: https://example.com', // 14
  '',
  '> 引用', // 16
  '',
  '| 列 | 值 |', // 18
  '| --- | --- |',
  '| a | 1 |', // 20
].join('\n')

const tree = unified().use(remarkParse).use(remarkGfm).use(remarkMath).parse(markdown) as unknown as MarkdownBlock

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    text: { group: 'inline' },
    paragraph: { content: 'inline*', group: 'block', toDOM: () => ['p', 0] },
    heading: { content: 'inline*', group: 'block', toDOM: () => ['h1', 0] },
    bullet_list: { content: 'list_item+', group: 'block', toDOM: () => ['ul', 0] },
    list_item: { content: 'paragraph block*', toDOM: () => ['li', 0] },
    code_block: { content: 'text*', group: 'block', code: true, marks: '', toDOM: () => ['pre', 0] },
    blockquote: { content: 'block+', group: 'block', toDOM: () => ['blockquote', 0] },
    table: { content: 'table_row+', group: 'block', toDOM: () => ['table', ['tbody', 0]] },
    table_row: { content: 'table_cell+', toDOM: () => ['tr', 0] },
    table_cell: { content: 'paragraph', toDOM: () => ['td', 0] },
  },
})

const n = schema.nodes
const p = (value: string) => n.paragraph.create(null, schema.text(value))
const cell = (value: string) => n.table_cell.create(null, p(value))
const item = (value: string, ...rest: Node[]) => n.list_item.create(null, [p(value), ...rest])
const doc = n.doc.create(null, [
  n.heading.create(null, schema.text('标题')),
  p('第一段'),
  n.bullet_list.create(null, [item('甲'), item('乙', n.bullet_list.create(null, item('乙一')))]),
  n.code_block.create(null, schema.text('const a = 1\nconst b = 2')),
  n.blockquote.create(null, p('引用')),
  n.table.create(null, [n.table_row.create(null, [cell('列'), cell('值')]), n.table_row.create(null, [cell('a'), cell('1')])]),
])

const rect = (top: number, height = 20) => new DOMRect(0, top, 600, height)
const viewport = rect(100, 600)

/**
 * Renders code like CodeMirror does: its own line elements and no editable content DOM. Before a block scrolls into
 * view Crepe shows a plain `<pre>` placeholder instead.
 */
function mount(placeholder = false): EditorView {
  const host = document.createElement('div')
  document.body.append(host)
  return new EditorView(host, {
    state: EditorState.create({ doc }),
    nodeViews: {
      code_block: (node) => {
        const dom = document.createElement('div')
        if (placeholder) {
          const pre = document.createElement('pre')
          Object.assign(pre.style, { lineHeight: '20px', paddingTop: '6px' })
          pre.textContent = node.textContent
          pre.getBoundingClientRect = () => rect(400, 60)
          dom.append(pre)
          return { dom }
        }
        node.textContent.split('\n').forEach((text, index) => {
          const line = document.createElement('div')
          line.className = 'cm-line'
          line.textContent = text
          line.getBoundingClientRect = () => rect(400 + index * 20)
          dom.append(line)
        })
        return { dom }
      },
    },
  })
}

const positionOf = (view: EditorView, text: string) => {
  let found = -1
  view.state.doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text === text) found = pos
    return found < 0
  })
  return found
}

describe('源码行与排版块的对应', () => {
  beforeAll(stubLayout)

  it('按行号找到最深一层的块，跳过链接定义与块之间的空行', () => {
    expect(blockPathAtLine(tree, 1)).toEqual([0])
    expect(blockPathAtLine(tree, 2)).toEqual([1])
    expect(blockPathAtLine(tree, 6)).toEqual([2, 1, 0])
    expect(blockPathAtLine(tree, 7)).toEqual([2, 1, 1, 0, 0])
    expect(blockPathAtLine(tree, 11)).toEqual([3])
    expect(blockPathAtLine(tree, 14)).toEqual([4])
    expect(blockPathAtLine(tree, 20)).toEqual([5, 1, 0])
    expect(blockPathAtLine(tree, 99)).toEqual([5, 1, 1])
    expect(lineAtBlockPath(tree, [2, 1, 1, 0, 0])).toBe(7)
    expect(lineAtBlockPath(tree, [4])).toBe(16)
    expect(lineAtBlockPath(tree, [9])).toBe(1)
    expect(lineAtBlockPath(tree, [])).toBe(1)
  })

  it('换算源码偏移与行号', () => {
    expect(lineAtOffset('a\nb\nc', 0)).toBe(1)
    expect(lineAtOffset('a\nb\nc', 2)).toBe(2)
    expect(lineAtOffset('a\nb\nc', 5)).toBe(3)
    expect(offsetAtLine('a\nb\nc', 3)).toBe(4)
    expect(offsetAtLine('a\nb\nc', 9)).toBe(4)
    expect(offsetAtLine('a\nb\nc', 0)).toBe(0)
  })

  it('源码框优先记录可见的光标行，光标不在屏幕内时记录首个可见行', () => {
    const metrics = { lineHeight: 28, paddingTop: 46 }
    const value = Array.from({ length: 100 }, (_, index) => `第 ${index + 1} 行`).join('\n')
    const visible = { value, selectionStart: offsetAtLine(value, 5), scrollTop: 0, clientHeight: 560 }
    expect(sourceAnchor(visible, metrics)).toEqual({ line: 5, ratio: (46 + 4 * 28) / 560 })
    const scrolled = { ...visible, selectionStart: 0, scrollTop: 46 + 40 * 28 }
    expect(sourceAnchor(scrolled, metrics)).toEqual({ line: 41, ratio: 0 })
    expect(sourceAnchor({ ...scrolled, scrollTop: 46 + 40 * 28 + 10 }, metrics).line).toBe(42)
    expect(sourceScrollTop({ line: 41, ratio: 0 }, 560, metrics)).toBe(46 + 40 * 28)
    expect(sourceScrollTop({ line: 41, ratio: 0.5 }, 560, metrics)).toBe(46 + 40 * 28 - 280)
    expect(sourceScrollTop({ line: 1, ratio: 0.9 }, 560, metrics)).toBe(0)
  })

  it('排版视图记录光标所在块的源码行，代码块内精确到行', () => {
    const view = mount()
    view.coordsAtPos = () => ({ left: 0, right: 0, top: 300, bottom: 320 })
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, positionOf(view, '乙一') + 1)))
    expect(visualAnchor(view, tree, markdown, viewport)).toEqual({ line: 7, ratio: 200 / 600 })

    const code = positionOf(view, 'const a = 1\nconst b = 2')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, code + 'const a = 1\nconst'.length)))
    expect(visualAnchor(view, tree, markdown, viewport)).toEqual({ line: 11, ratio: 320 / 600 })
    view.destroy()
  })

  it('光标滚出屏幕时改用首个可见块', () => {
    const view = mount()
    view.coordsAtPos = () => ({ left: 0, right: 0, top: 20, bottom: 40 })
    const blocks = Array.from(view.dom.children) as HTMLElement[]
    blocks.forEach((block, index) => { block.getBoundingClientRect = () => rect(index * 60, 50) })
    expect(visualAnchor(view, tree, markdown, viewport)).toEqual({ line: 3, ratio: -40 / 600 })
    blocks.forEach((block) => { block.getBoundingClientRect = () => rect(-500) })
    expect(visualAnchor(view, tree, markdown, viewport)).toBeNull()
    view.destroy()
  })

  it('按源码行放置光标并滚动到原来的屏幕位置', () => {
    const view = mount()
    const scroller = document.createElement('div')
    scroller.getBoundingClientRect = () => viewport
    view.coordsAtPos = () => ({ left: 0, right: 0, top: 700, bottom: 720 })

    revealAnchor(view, tree, markdown, { line: 7, ratio: 0.25 }, scroller)
    expect(view.state.selection.$head.parent.textContent).toBe('乙一')
    expect(scroller.scrollTop).toBe(700 - 100 - 150)

    scroller.scrollTop = 0
    revealAnchor(view, tree, markdown, { line: 11, ratio: 0 }, scroller)
    expect(view.state.selection.$head.parentOffset).toBe('const a = 1\n'.length)
    expect(scroller.scrollTop).toBe(420 - 100)

    revealAnchor(view, tree, markdown, { line: 14, ratio: 0 }, scroller)
    expect(view.state.selection.$head.parent.textContent).toBe('引用')
    revealAnchor(view, tree, markdown, { line: 20, ratio: 0 }, scroller)
    expect(view.state.selection.$head.parent.textContent).toBe('a')
    view.destroy()
  })

  it('代码块尚未挂载 CodeMirror 时按占位元素的行高估算代码行位置', () => {
    const view = mount(true)
    const scroller = document.createElement('div')
    scroller.getBoundingClientRect = () => viewport
    revealAnchor(view, tree, markdown, { line: 11, ratio: 0 }, scroller)
    expect(view.state.selection.$head.parentOffset).toBe('const a = 1\n'.length)
    expect(scroller.scrollTop).toBe(400 + 6 + 20 - 100)
    view.destroy()
  })
})
