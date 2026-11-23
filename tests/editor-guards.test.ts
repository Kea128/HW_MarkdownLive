import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { EditorState as CodeState } from '@codemirror/state'
import { EditorView as CodeView } from '@codemirror/view'
import type { EditorView, NodeViewConstructor } from '@milkdown/kit/prose/view'
import { codeReadOnlyOverride, syncCodeReadOnly } from '../src/editor-guards'
import { codeBlock, mountView, paragraph, stubLayout, text } from './prose-fixture'

let view: EditorView
let code: CodeView | null = null

/** Like Milkdown, the block takes the editor's read-only flag once, when it mounts. */
const lockedOnMount: NodeViewConstructor = (node) => {
  const dom = document.createElement('div')
  code = new CodeView({ doc: node.textContent, extensions: [CodeState.readOnly.of(true), codeReadOnlyOverride], parent: dom })
  return { dom, ignoreMutation: () => true, stopEvent: () => true, destroy: () => code?.destroy() }
}

beforeAll(stubLayout)
afterEach(() => view?.destroy())

describe('阅读模式切换', () => {
  it('在阅读模式挂载的代码块，回到编辑后可以输入；再进入阅读模式又锁定', () => {
    view = mountView([paragraph(text('正文')), codeBlock('const a = 1')], { code_block: lockedOnMount })
    expect(code?.state.readOnly).toBe(true)
    syncCodeReadOnly(view)
    expect(code?.state.readOnly).toBe(false)
    view.setProps({ editable: () => false })
    syncCodeReadOnly(view)
    expect(code?.state.readOnly).toBe(true)
  })
})
