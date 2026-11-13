import type { Editor } from '@milkdown/kit/core'
import { remarkPreserveEmptyLinePlugin } from '@milkdown/kit/preset/commonmark'
import { $remark } from '@milkdown/kit/utils'

export interface MarkdownNode {
  type: string
  value?: unknown
  children?: MarkdownNode[]
}

const isBreak = (node: MarkdownNode) => node.type === 'html' && /^<br\s*\/?>$/i.test(String(node.value ?? '').trim())

/** Only a paragraph made of a single `<br />` is Milkdown's empty-line marker; inline `<br>` must survive. */
export function removeEmptyLineMarkers(node: MarkdownNode): void {
  if (!node.children) return
  if (node.type === 'paragraph' && node.children.length === 1 && isBreak(node.children[0])) {
    node.children = []
    return
  }
  node.children.forEach(removeEmptyLineMarkers)
}

const preserveEmptyLines = $remark('inkdownPreserveEmptyLine', () => () => (tree) => {
  removeEmptyLineMarkers(tree as unknown as MarkdownNode)
})

/** Milkdown's own plugin deletes every `<br>`, so line breaks in Typora and GitHub tables were lost on save. */
export function keepInlineBreaks(editor: Editor): void {
  void editor.remove(remarkPreserveEmptyLinePlugin)
  editor.use(preserveEmptyLines)
}
