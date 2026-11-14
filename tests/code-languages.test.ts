import { describe, expect, it, vi } from 'vitest'
import type { Editor } from '@milkdown/kit/core'
import { createCodeBlockInputRule } from '@milkdown/kit/preset/commonmark'
import { Schema, type Node } from '@milkdown/kit/prose/model'
import { EditorState, TextSelection } from '@milkdown/kit/prose/state'
import { EditorView } from '@milkdown/kit/prose/view'
import { applyDefaultCodeLanguage, CODE_FENCE_RULE, fenceOnEnter, plainTextLanguage } from '../src/code-languages'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    text: { group: 'inline' },
    paragraph: { content: 'inline*', group: 'block', toDOM: () => ['p', 0] },
    heading: { content: 'inline*', group: 'block', toDOM: () => ['h1', 0] },
    code_block: {
      content: 'text*', group: 'block', code: true, attrs: { language: { default: '' } }, toDOM: () => ['pre', 0],
    },
    list_item: { content: 'paragraph block*', group: 'block', toDOM: () => ['li', 0] },
  },
})

function viewWith(node: Node, caretAtEnd = true): EditorView {
  const doc = schema.nodes.doc.create(null, node)
  const position = caretAtEnd ? doc.content.size - (node.type.name === 'list_item' ? 2 : 1) : 1
  const state = EditorState.create({ doc, selection: TextSelection.create(doc, position) })
  return new EditorView(document.createElement('div'), { state })
}

const enter = (init: KeyboardEventInit = {}) => new KeyboardEvent('keydown', { key: 'Enter', ...init })
const codeBlock = schema.nodes.code_block

describe('代码块语言', () => {
  it('语言列表提供纯文本，搜索 text、txt 或纯文本都能找到', async () => {
    expect(plainTextLanguage.name).toBe('text')
    expect(plainTextLanguage.alias).toEqual(expect.arrayContaining(['text', 'plaintext', 'txt', '纯文本']))
    expect(await plainTextLanguage.load()).toBeDefined()
  })

  it('``` 后的语言名支持大小写、数字与 c++、c# 一类写法，空着时交给默认语言', () => {
    const language = (input: string) => CODE_FENCE_RULE.exec(input)?.groups?.language
    expect(language('```Python ')).toBe('Python')
    expect(language('```c++\n')).toBe('c++')
    expect(language('```c# ')).toBe('c#')
    expect(language('```objective-c ')).toBe('objective-c')
    expect(CODE_FENCE_RULE.test('``` ')).toBe(true)
    expect(language('``` ')).toBeUndefined()
    expect(CODE_FENCE_RULE.test('```a b ')).toBe(false)
  })

  it('只有 ``` 的段落按回车变成代码块，没写语言时用默认语言', () => {
    const plain = viewWith(schema.nodes.paragraph.create(null, schema.text('```')))
    expect(fenceOnEnter(plain, enter(), codeBlock, 'text')).toBe(true)
    expect(plain.state.doc.firstChild?.type.name).toBe('code_block')
    expect(plain.state.doc.firstChild?.attrs.language).toBe('text')
    expect(plain.state.doc.firstChild?.textContent).toBe('')
    expect(plain.state.selection.$from.parent.type.name).toBe('code_block')

    const named = viewWith(schema.nodes.paragraph.create(null, schema.text('```Rust')))
    expect(fenceOnEnter(named, enter(), codeBlock, 'text')).toBe(true)
    expect(named.state.doc.firstChild?.attrs.language).toBe('Rust')
  })

  it('其他按键、组合键、标题、光标不在末尾或位置不允许代码块时保持原样', () => {
    const fence = () => schema.nodes.paragraph.create(null, schema.text('```'))
    expect(fenceOnEnter(viewWith(fence()), enter({ shiftKey: true }), codeBlock, 'text')).toBe(false)
    expect(fenceOnEnter(viewWith(fence()), new KeyboardEvent('keydown', { key: 'a' }), codeBlock, 'text')).toBe(false)
    expect(fenceOnEnter(viewWith(fence(), false), enter(), codeBlock, 'text')).toBe(false)
    expect(fenceOnEnter(viewWith(schema.nodes.paragraph.create(null, schema.text('```js x'))), enter(), codeBlock, ''))
      .toBe(false)
    expect(fenceOnEnter(viewWith(schema.nodes.heading.create(null, schema.text('```'))), enter(), codeBlock, '')).toBe(false)
    const listItem = viewWith(schema.nodes.list_item.create(null, fence()))
    expect(fenceOnEnter(listItem, enter(), codeBlock, 'text')).toBe(false)
    expect(listItem.state.doc.textContent).toBe('```')
  })

  it('用带默认语言的规则替换 Milkdown 自带的 ``` 规则，并接管回车', () => {
    const editor = { remove: vi.fn(async () => undefined), use: vi.fn(), config: vi.fn() }
    editor.use.mockReturnValue(editor)
    editor.config.mockReturnValue(editor)
    applyDefaultCodeLanguage(editor as unknown as Editor, () => 'text')
    expect(editor.remove).toHaveBeenCalledWith(createCodeBlockInputRule)
    expect(editor.use).toHaveBeenCalledOnce()
    expect(editor.config).toHaveBeenCalledOnce()
  })
})
