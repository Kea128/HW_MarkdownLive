import { LanguageDescription, LanguageSupport, StreamLanguage } from '@codemirror/language'
import { editorViewOptionsCtx, type Editor } from '@milkdown/kit/core'
import { codeBlockSchema, createCodeBlockInputRule } from '@milkdown/kit/preset/commonmark'
import { textblockTypeInputRule } from '@milkdown/kit/prose/inputrules'
import type { NodeType } from '@milkdown/kit/prose/model'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $inputRule } from '@milkdown/kit/utils'

const plainText = StreamLanguage.define<null>({
  name: 'text',
  token: (stream) => {
    stream.skipToEnd()
    return null
  },
})

/** CodeMirror's language list has no plain text entry, so searching "text" in the picker only offered Textile. */
export const plainTextLanguage = LanguageDescription.of({
  name: 'text',
  alias: ['plaintext', 'plain', 'txt', '纯文本'],
  support: new LanguageSupport(plainText),
})

export const CODE_FENCE_RULE = /^```(?<language>[\w+#.-]*)?[\s\n]$/
const FENCE_PARAGRAPH = /^```([\w+#.-]*)$/

/** Typora's way in: a paragraph holding only ``` and an optional language becomes a code block on Enter. */
export function fenceOnEnter(view: EditorView, event: KeyboardEvent, type: NodeType, language: string): boolean {
  if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return false
  const { $from, empty } = view.state.selection
  if (!empty || $from.parent.type.name !== 'paragraph' || $from.parentOffset !== $from.parent.content.size) return false
  const match = FENCE_PARAGRAPH.exec($from.parent.textContent)
  const index = $from.index(-1)
  if (!match || !$from.node(-1).canReplaceWith(index, index + 1, type)) return false
  const start = $from.start()
  view.dispatch(view.state.tr
    .delete(start, $from.end())
    .setBlockType(start, start, type, { language: match[1] || language })
    .scrollIntoView())
  return true
}

/**
 * The stock ``` rule accepts only lowercase letters and leaves the language empty when none is typed, and ProseMirror
 * input rules never see Enter. Direct view props run before the keymap that would split the paragraph instead.
 */
export function applyDefaultCodeLanguage(editor: Editor, language: () => string): void {
  void editor.remove(createCodeBlockInputRule)
  editor
    .config((ctx) => {
      ctx.update(editorViewOptionsCtx, (previous) => ({
        ...previous,
        handleKeyDown: (view, event) => Boolean(previous.handleKeyDown?.(view, event))
          || fenceOnEnter(view, event, codeBlockSchema.type(ctx), language()),
      }))
    })
    .use($inputRule((ctx) => textblockTypeInputRule(
      CODE_FENCE_RULE,
      codeBlockSchema.type(ctx),
      (match) => ({ language: match.groups?.language || language() }),
    )))
}
