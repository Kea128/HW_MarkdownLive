import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { EditorView as CodeView } from '@codemirror/view'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView, NodeViewConstructor } from '@milkdown/kit/prose/view'
import {
  codeSearchHighlight, collectMatches, moveSearch, replaceAllMatches, replaceCurrent, searchPlugin, searchResult,
  setSearchQuery,
} from '../src/editor-search'
import { compileQuery, EMPTY_QUERY, type SearchQuery } from '../src/search'
import { codeBlock, html, image, mountView, paragraph, stubLayout, text } from './prose-fixture'

let view: EditorView
const query = (value: string, options: Partial<SearchQuery> = {}): SearchQuery => ({ ...EMPTY_QUERY, text: value, ...options })
const highlighted = (selector = '.search-match') => [...view.dom.querySelectorAll(selector)].map((element) => element.textContent)
const selected = () => view.state.doc.textBetween(view.state.selection.from, view.state.selection.to)
const blockTexts = () => {
  const texts: string[] = []
  view.state.doc.forEach((node) => texts.push(node.textContent))
  return texts
}

function mount(nodes: Parameters<typeof mountView>[0], nodeViews: Record<string, NodeViewConstructor> = {}) {
  const onResult = vi.fn()
  view = mountView(nodes, nodeViews, [searchPlugin(onResult)])
  return onResult
}

/** Code blocks are CodeMirror editors inside the document, as in Crepe. */
const codeMirrorBlock: NodeViewConstructor = (node) => {
  const dom = document.createElement('div')
  const code = new CodeView({ doc: node.textContent, extensions: [codeSearchHighlight], parent: dom })
  return { dom, ignoreMutation: () => true, stopEvent: () => true, destroy: () => code.destroy() }
}

beforeAll(stubLayout)
afterEach(() => view?.destroy())

describe('所见即所得与阅读模式的查找', () => {
  it('高亮全部匹配，选中当前项，上一个/下一个循环移动', () => {
    const onResult = mount([paragraph(text('周报：本周完成周报模板')), paragraph(text('下周继续'))])
    setSearchQuery(view, query('周'))
    expect(highlighted()).toEqual(['周', '周', '周', '周'])
    expect(highlighted('.search-current')).toEqual(['周'])
    expect(searchResult(view)).toEqual({ count: 4, current: 0 })
    expect(onResult).toHaveBeenLastCalledWith({ count: 4, current: 0 })
    expect(selected()).toBe('周')

    moveSearch(view, -1)
    expect(searchResult(view).current).toBe(3)
    expect(view.state.selection.from).toBe(15)
    moveSearch(view, 1)
    expect(searchResult(view).current).toBe(0)
    expect(onResult).toHaveBeenLastCalledWith({ count: 4, current: 0 })
  })

  it('从光标处开始找；重新套用查询时不移动光标', () => {
    mount([paragraph(text('a b a b a'))])
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 4)))
    setSearchQuery(view, query('a'))
    expect(searchResult(view)).toEqual({ count: 3, current: 1 })
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)))
    setSearchQuery(view, query('b'), false)
    expect(searchResult(view)).toEqual({ count: 2, current: 0 })
    expect(view.state.selection.from).toBe(2)
    expect(view.state.selection.empty).toBe(true)
  })

  it('图片、公式等原子节点不会让高亮错位，也不会被字面量匹配', () => {
    mount([paragraph(text('前'), image('a.png'), text('目标'), html('<b>目标</b>'), text('目标'))])
    setSearchQuery(view, query('目标'))
    expect(highlighted()).toEqual(['目标', '目标'])
    setSearchQuery(view, query('前目标', { regex: true }))
    expect(searchResult(view).count).toBe(0)
  })

  it('代码块里的匹配计入总数，由 CodeMirror 自己高亮，当前项单独标出', async () => {
    mount([paragraph(text('const 值')), codeBlock('const a = 1\nconst b = 2')], { code_block: codeMirrorBlock })
    setSearchQuery(view, query('const'))
    expect(searchResult(view).count).toBe(3)
    expect(highlighted()).toEqual(['const'])
    expect(collectMatches(view.state.doc, compileQuery(query('const')) as RegExp).map((match) => match.block))
      .toEqual([null, 9, 9])
    await vi.waitFor(() => expect(highlighted('.cm-search-match')).toEqual(['const', 'const']))
    expect(highlighted('.cm-search-current')).toEqual([])

    moveSearch(view, 1)
    await vi.waitFor(() => expect(view.dom.querySelectorAll('.cm-search-current')).toHaveLength(1))
    expect(highlighted('.search-current')).toEqual([])
    const lines = [...view.dom.querySelectorAll('.cm-line')]
    expect(lines[0].querySelector('.cm-search-current')).not.toBeNull()

    setSearchQuery(view, null)
    await vi.waitFor(() => expect(view.dom.querySelectorAll('.cm-search-match')).toHaveLength(0))
    expect(highlighted()).toEqual([])
  })

  it('替换当前项后跳到下一个，即使替换结果仍然匹配也不会重复替换', () => {
    mount([paragraph(text('foo bar foo'))])
    setSearchQuery(view, query('foo'))
    expect(replaceCurrent(view, 'foo!')).toBe(true)
    expect(blockTexts()).toEqual(['foo! bar foo'])
    expect(searchResult(view)).toEqual({ count: 2, current: 1 })
    expect(selected()).toBe('foo')
    expect(replaceCurrent(view, 'foo!')).toBe(true)
    expect(blockTexts()).toEqual(['foo! bar foo!'])
    expect(searchResult(view).current).toBe(0)
    expect(replaceCurrent(view, '')).toBe(true)
    expect(blockTexts()).toEqual(['! bar foo!'])
  })

  it('全部替换覆盖正文与代码块，正则可引用分组', () => {
    mount([paragraph(text('v1.2 与 v3.4')), codeBlock('version = v5.6')])
    setSearchQuery(view, query('v(\\d)\\.(\\d)', { regex: true }))
    expect(replaceAllMatches(view, '$2.$1')).toBe(3)
    expect(blockTexts()).toEqual(['2.1 与 4.3', 'version = 6.5'])
    expect(searchResult(view)).toEqual({ count: 0, current: -1 })
  })

  it('编辑文档时当前项跟着原来的匹配走', () => {
    mount([paragraph(text('a b a'))])
    setSearchQuery(view, query('a'))
    moveSearch(view, 1)
    view.dispatch(view.state.tr.insertText('a', 1))
    expect(searchResult(view)).toEqual({ count: 3, current: 2 })
  })

  it('只读时不替换；清空或无效的查询去掉所有高亮', () => {
    mount([paragraph(text('只读 只读'))])
    setSearchQuery(view, query('只读'))
    view.setProps({ editable: () => false })
    expect(replaceCurrent(view, '可写')).toBe(false)
    expect(replaceAllMatches(view, '可写')).toBe(0)
    expect(blockTexts()).toEqual(['只读 只读'])
    setSearchQuery(view, query('(', { regex: true }))
    expect(searchResult(view).count).toBe(0)
    expect(highlighted()).toEqual([])
    setSearchQuery(view, query('只读'))
    setSearchQuery(view, null)
    expect(highlighted()).toEqual([])
  })
})
