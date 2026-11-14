import { describe, expect, it, vi } from 'vitest'
import { contextMenuTemplate, type ContextMenuInput } from '../electron/main/context-menu'

const editFlags = {
  canUndo: true, canRedo: false, canCut: true, canCopy: true, canPaste: true, canDelete: true, canSelectAll: true,
  canEditRichly: true,
}
const params = (overrides: Partial<ContextMenuInput>): ContextMenuInput => ({
  isEditable: true, editFlags, selectionText: '', misspelledWord: '', dictionarySuggestions: [], ...overrides,
})

describe('右键菜单', () => {
  it('拼写错误时先给出建议和加入词典，再提供剪贴板操作', () => {
    const actions = { replaceMisspelling: vi.fn(), addToDictionary: vi.fn() }
    const items = contextMenuTemplate(params({
      misspelledWord: 'teh', dictionarySuggestions: ['the', 'tea', 'ten', 'tech', 'teach', 'tenth'],
    }), actions)
    expect(items.map((item) => item.label ?? item.type)).toEqual([
      'the', 'tea', 'ten', 'tech', 'teach', '添加到词典', 'separator', '剪切', '复制', '粘贴', 'separator', '全选',
    ])
    items[0].click?.({} as never, undefined, {} as never)
    items[5].click?.({} as never, undefined, {} as never)
    expect(actions.replaceMisspelling).toHaveBeenCalledWith('the')
    expect(actions.addToDictionary).toHaveBeenCalledWith('teh')
  })

  it('没有建议时给出提示，只读区域只能复制选中文字', () => {
    const actions = { replaceMisspelling: vi.fn(), addToDictionary: vi.fn() }
    const noSuggestions = contextMenuTemplate(params({ misspelledWord: 'inkdwn' }), actions)
    expect(noSuggestions[0]).toMatchObject({ label: '没有拼写建议', enabled: false })
    expect(contextMenuTemplate(params({ isEditable: false, selectionText: '段落' }), actions))
      .toEqual([{ role: 'copy', label: '复制' }])
    expect(contextMenuTemplate(params({ isEditable: false, selectionText: '  ' }), actions)).toEqual([])
    const disabled = contextMenuTemplate(params({ editFlags: { ...editFlags, canPaste: false } }), actions)
    expect(disabled.find((item) => item.label === '粘贴')).toMatchObject({ enabled: false })
  })
})
