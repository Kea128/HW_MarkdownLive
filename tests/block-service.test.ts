import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import type { EditorView } from '@milkdown/kit/prose/view'
import { TextSelection } from '@milkdown/kit/prose/state'
import { resolveBlock, ResponsiveBlockService } from '../src/block-service'
import { mountView, paragraph, stubLayout, text } from './prose-fixture'

let view: EditorView
const acceptAll = () => true
const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))

function bindService(filterNodes = acceptAll) {
  const service = new ResponsiveBlockService()
  const notify = vi.fn()
  const ctx = { get: (slice: unknown) => slice === editorViewCtx ? view : { filterNodes } } as unknown as Ctx
  service.bind(ctx, notify)
  return { service, notify }
}

beforeAll(stubLayout)
afterEach(() => view?.destroy())

describe('块手柄', () => {
  it('从光标或指针所在位置找到所属的块', () => {
    view = mountView([paragraph(text('第一段')), paragraph(text('第二段'))])
    const second = resolveBlock(view, 5, acceptAll)
    expect(second?.node.textContent).toBe('第二段')
    expect(second?.el.tagName).toBe('P')
    expect(resolveBlock(view, 999, acceptAll)).toBeNull()
  })

  it('指针移动后在下一帧显示手柄，而不是等待 200 毫秒', async () => {
    view = mountView([paragraph(text('第一段')), paragraph(text('第二段'))])
    const { service, notify } = bindService()
    const target = view.dom.children[1]
    document.elementFromPoint = () => target
    view.posAtCoords = () => ({ pos: 6, inside: 5 })
    service.mousemoveCallback(view, new MouseEvent('pointermove', { clientY: 40 }))
    service.mousemoveCallback(view, new MouseEvent('pointermove', { clientY: 42 }))
    expect(notify).not.toHaveBeenCalled()
    await frame()
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0][0]).toMatchObject({ type: 'show', active: { el: target } })

    document.elementFromPoint = () => null
    service.mousemoveCallback(view, new MouseEvent('pointermove', { clientY: 400 }))
    await frame()
    expect(notify).toHaveBeenLastCalledWith({ type: 'hide' })
  })

  it('按方向键移动光标后手柄跟到光标所在的块，输入文字时保持隐藏', async () => {
    view = mountView([paragraph(text('第一段')), paragraph(text('第二段'))])
    const { service, notify } = bindService()
    service.keydownCallback(view)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 7)))
    expect(notify).toHaveBeenLastCalledWith({ type: 'hide' })
    await frame()
    expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'show' }))
    expect(notify.mock.lastCall?.[0].active.node.textContent).toBe('第二段')

    notify.mockClear()
    service.keydownCallback(view)
    view.dispatch(view.state.tr.insertText('字'))
    await frame()
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenLastCalledWith({ type: 'hide' })
  })

  it('拖动块时记录状态并在结束后复位', () => {
    view = mountView([paragraph(text('第一段'))])
    const { service } = bindService()
    view.dragging = { slice: view.state.doc.slice(0, 1), move: true }
    service.dragenterCallback(view)
    expect(view.dom.dataset.dragging).toBe('true')
    expect(service.dropCallback(view)).toBe(false)
    expect(view.dom.dataset.dragging).toBe('false')
    service.dragleaveCallback(view, new MouseEvent('dragleave', { clientX: -1, clientY: -1 }) as DragEvent)
    expect(service.dragoverCallback(view, new MouseEvent('dragover') as DragEvent)).toBe(false)
    const handle = document.createElement('div')
    service.addEvent(handle)
    service.removeEvent(handle)
    service.unBind()
  })
})
