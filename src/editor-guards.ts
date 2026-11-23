import { Compartment, EditorState as CodeState, Prec } from '@codemirror/state'
import { EditorView as CodeView } from '@codemirror/view'
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

const codeReadOnly = new Compartment()

/**
 * A code block takes its read-only flag when its CodeMirror mounts, and Milkdown refreshes it only when the block
 * itself changes, so blocks mounted in reading mode would stay locked after switching back to editing.
 */
export const codeReadOnlyOverride = codeReadOnly.of([])

export function syncCodeReadOnly(view: EditorView): void {
  const effects = codeReadOnly.reconfigure(Prec.highest(CodeState.readOnly.of(!view.editable)))
  for (const element of view.dom.querySelectorAll<HTMLElement>('.cm-editor')) CodeView.findFromDOM(element)?.dispatch({ effects })
}
