import type { Editor } from '@milkdown/kit/core'
import { Plugin } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'

/**
 * `setReadonly` only stops typing into the editor itself: CodeMirror code blocks still turn Backspace or Ctrl+Enter
 * into document commands, and Ctrl+Z runs history. Reading mode refuses every transaction that changes the document.
 */
export function guardReadOnly(editor: Editor): void {
  editor.use($prose(() => {
    let view: EditorView | null = null
    return new Plugin({
      view: (editorView) => {
        view = editorView
        return { destroy: () => { view = null } }
      },
      filterTransaction: (tr) => !tr.docChanged || view?.editable !== false,
    })
  }))
}
