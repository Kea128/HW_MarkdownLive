import type { ContextMenuParams, MenuItemConstructorOptions } from 'electron'

export type ContextMenuInput = Pick<
  ContextMenuParams, 'isEditable' | 'editFlags' | 'selectionText' | 'misspelledWord' | 'dictionarySuggestions'
>

export interface ContextMenuActions {
  replaceMisspelling(word: string): void
  addToDictionary(word: string): void
}

const MAX_SUGGESTIONS = 5

/** Undo and redo are left out: ProseMirror keeps its own history, which the native commands cannot reach. */
export function contextMenuTemplate(params: ContextMenuInput, actions: ContextMenuActions): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = []
  if (params.isEditable && params.misspelledWord) {
    const suggestions = params.dictionarySuggestions.slice(0, MAX_SUGGESTIONS)
    items.push(
      ...suggestions.map((word): MenuItemConstructorOptions => ({ label: word, click: () => actions.replaceMisspelling(word) })),
      ...(suggestions.length ? [] : [{ label: '没有拼写建议', enabled: false }]),
      { label: '添加到词典', click: () => actions.addToDictionary(params.misspelledWord) },
      { type: 'separator' },
    )
  }
  if (params.isEditable) {
    items.push(
      { role: 'cut', label: '剪切', enabled: params.editFlags.canCut },
      { role: 'copy', label: '复制', enabled: params.editFlags.canCopy },
      { role: 'paste', label: '粘贴', enabled: params.editFlags.canPaste },
      { type: 'separator' },
      { role: 'selectAll', label: '全选', enabled: params.editFlags.canSelectAll },
    )
  } else if (params.selectionText.trim()) {
    items.push({ role: 'copy', label: '复制' })
  }
  return items
}
