import { editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import {
  blockConfig, type ActiveNode, type BlockServiceMessage, type FilterNodes,
} from '@milkdown/kit/plugin/block'
import { NodeSelection, type Selection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'

const SCROLL_BUFFER = 20

/** Same block resolution as Milkdown's handle, starting from the node at `inside`. */
export function resolveBlock(view: EditorView, inside: number, filterNodes: FilterNodes): ActiveNode | null {
  try {
    let $pos = view.state.doc.resolve(inside)
    let node = view.state.doc.nodeAt(inside)
    let element = view.nodeDOM(inside) as HTMLElement | null
    const lookUp = (force: boolean) => {
      if (!force && !($pos.depth >= 1 && $pos.index($pos.depth) === 0)) return
      const ancestor = $pos.before($pos.depth)
      node = view.state.doc.nodeAt(ancestor)
      element = view.nodeDOM(ancestor) as HTMLElement | null
      $pos = view.state.doc.resolve(ancestor)
      if (node && !filterNodes($pos, node)) lookUp(true)
    }
    if (!node) return null
    lookUp(!filterNodes($pos, node))
    return element && node ? { node, $pos, el: element } : null
  } catch {
    return null
  }
}

/**
 * Replacement for Milkdown's block service: the stock one throttles pointer tracking to 200 ms and hides the handle
 * on every key press, so the handle lagged behind the pointer and vanished during keyboard navigation.
 */
export class ResponsiveBlockService {
  #ctx?: Ctx
  #notify?: BlockServiceMessage
  #active: ActiveNode | null = null
  #activeSelection: Selection | null = null
  #activeRect?: DOMRect
  #dragging = false
  #frame = 0
  #pointer: { view: EditorView; y: number } | null = null

  get #view(): EditorView | undefined {
    return this.#ctx?.get(editorViewCtx)
  }

  get #filterNodes(): FilterNodes | undefined {
    try {
      return this.#ctx?.get(blockConfig.key).filterNodes
    } catch {
      return undefined
    }
  }

  bind = (ctx: Ctx, notify: BlockServiceMessage) => {
    this.#ctx = ctx
    this.#notify = notify
  }

  unBind = () => {
    this.#notify = undefined
    cancelAnimationFrame(this.#frame)
  }

  addEvent = (dom: HTMLElement) => {
    dom.addEventListener('mousedown', this.#mouseDown)
    dom.addEventListener('mouseup', this.#mouseUp)
    dom.addEventListener('dragstart', this.#dragStart)
    dom.addEventListener('dragend', this.#dragEndEvent)
  }

  removeEvent = (dom: HTMLElement) => {
    dom.removeEventListener('mousedown', this.#mouseDown)
    dom.removeEventListener('mouseup', this.#mouseUp)
    dom.removeEventListener('dragstart', this.#dragStart)
    dom.removeEventListener('dragend', this.#dragEndEvent)
  }

  #show(active: ActiveNode): void {
    this.#active = active
    this.#notify?.({ type: 'show', active })
  }

  #hide(): void {
    this.#active = null
    this.#notify?.({ type: 'hide' })
  }

  mousemoveCallback = (view: EditorView, event: MouseEvent) => {
    if (view.composing || !view.editable) return false
    this.#pointer = { view, y: event.clientY }
    if (!this.#frame) this.#frame = requestAnimationFrame(this.#track)
    return false
  }

  #track = () => {
    this.#frame = 0
    const pointer = this.#pointer
    const filterNodes = this.#filterNodes
    if (!pointer || !filterNodes || !pointer.view.editable || pointer.view.isDestroyed) return
    const { view, y } = pointer
    const rect = view.dom.getBoundingClientRect()
    const x = rect.left + rect.width / 2
    if (!(view.root.elementFromPoint(x, y) instanceof Element)) {
      this.#hide()
      return
    }
    const inside = view.posAtCoords({ left: x, top: y })?.inside
    const active = inside === undefined || inside < 0 ? null : resolveBlock(view, inside, filterNodes)
    if (active) this.#show(active)
    else this.#hide()
  }

  keydownCallback = (view: EditorView) => {
    this.#dragging = false
    view.dom.dataset.dragging = 'false'
    this.#hide()
    const before = view.state.doc
    requestAnimationFrame(() => {
      if (view.isDestroyed || view.state.doc !== before) return
      const filterNodes = this.#filterNodes
      const { $head } = view.state.selection
      if (!filterNodes || $head.depth < 1) return
      const active = resolveBlock(view, $head.before($head.depth), filterNodes)
      if (active) this.#show(active)
    })
    return false
  }

  #mouseDown = () => {
    this.#activeRect = this.#active?.el.getBoundingClientRect()
    const view = this.#view
    const active = this.#active
    if (!view || !active || !NodeSelection.isSelectable(active.node)) return
    const selection = NodeSelection.create(view.state.doc, active.$pos.pos)
    view.dispatch(view.state.tr.setSelection(selection))
    view.focus()
    this.#activeSelection = selection
  }

  #mouseUp = () => {
    if (this.#dragging) {
      this.#dragging = false
      this.#activeSelection = null
      return
    }
    requestAnimationFrame(() => {
      if (this.#activeRect) this.#view?.focus()
    })
  }

  #dragStart = (event: DragEvent) => {
    this.#dragging = true
    const view = this.#view
    if (!view) return
    view.dom.dataset.dragging = 'true'
    const selection = this.#activeSelection
    if (!event.dataTransfer || !selection) return
    const slice = selection.content()
    event.dataTransfer.effectAllowed = 'copyMove'
    const { dom, text } = view.serializeForClipboard(slice)
    event.dataTransfer.clearData()
    event.dataTransfer.setData('text/html', dom.innerHTML)
    event.dataTransfer.setData('text/plain', text)
    if (this.#active?.el) event.dataTransfer.setDragImage(this.#active.el, 0, 0)
    view.dragging = { slice, move: true }
  }

  #dragEndEvent = () => {
    if (this.#view) this.#dragEnd(this.#view)
  }

  dragoverCallback = (view: EditorView, event: DragEvent) => {
    if (!this.#dragging) return false
    const root = view.dom.parentElement
    if (!root || root.scrollHeight <= root.clientHeight) return false
    const bounds = root.getBoundingClientRect()
    if (root.scrollTop > 0 && Math.abs(event.y - bounds.y) < SCROLL_BUFFER) {
      root.scrollTop = Math.max(0, root.scrollTop - 10)
    } else if (Math.round(root.scrollTop + bounds.height) < Math.round(view.dom.getBoundingClientRect().height)
      && Math.abs(event.y - (bounds.height + bounds.y)) < SCROLL_BUFFER) {
      root.scrollTop += 10
    }
    return false
  }

  dragenterCallback = (view: EditorView) => {
    if (!view.dragging) return
    this.#dragging = true
    view.dom.dataset.dragging = 'true'
  }

  dragleaveCallback = (view: EditorView, event: DragEvent) => {
    if (event.clientX < 0 || event.clientY < 0 || event.clientX > window.innerWidth || event.clientY > window.innerHeight) {
      this.#active = null
      this.#dragEnd(view)
    }
  }

  dropCallback = (view: EditorView) => {
    this.#dragEnd(view)
    return false
  }

  dragendCallback = (view: EditorView) => {
    this.#dragEnd(view)
  }

  #dragEnd(view: EditorView): void {
    this.#dragging = false
    view.dom.dataset.dragging = 'false'
  }
}
