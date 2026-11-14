import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { NodeSelection } from '@milkdown/kit/prose/state'
import type { EditorView, NodeView } from '@milkdown/kit/prose/view'
import {
  describeSize, IMAGE_SIZE_PRESETS, imageHtml, isLocalImage, isPlainImage, MIN_IMAGE_WIDTH, type ImageAlign,
  type ImageModel,
} from './image-model'

export interface ImageActions {
  resolve(src: string): string
  choose(): Promise<{ src: string; alt: string } | null>
  reveal(src: string): void
  open(src: string): void
  copy(src: string): void
}

const icon = (paths: string) => '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" '
  + `stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`

const icons = {
  left: icon('<path d="M21 6H3"/><path d="M15 12H3"/><path d="M17 18H3"/>'),
  center: icon('<path d="M21 6H3"/><path d="M17 12H7"/><path d="M19 18H5"/>'),
  right: icon('<path d="M21 6H3"/><path d="M21 12H9"/><path d="M21 18H7"/>'),
  alt: icon('<path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>'),
  replace: icon('<path d="M3 12a9 9 0 0 1 15.7-6L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.7 6L3 16"/>'
    + '<path d="M8 16H3v5"/>'),
  reveal: icon('<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5'
    + 'a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>'),
  copy: icon('<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>'),
  open: icon('<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>'),
  remove: icon('<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>'),
  check: icon('<path d="M20 6 9 17l-5-5"/>'),
  close: icon('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
}

const alignLabels: Record<ImageAlign, string> = { left: '左对齐', center: '居中', right: '右对齐' }

/** Selectable image with an edit toolbar and resize handles, shared by Markdown images and Typora's `<img>` HTML. */
export class ImageView implements NodeView {
  readonly dom = document.createElement('span')
  readonly #frame = document.createElement('span')
  readonly #image = document.createElement('img')
  readonly #broken = document.createElement('span')
  readonly #size = document.createElement('span')
  readonly #toolbar = document.createElement('span')
  readonly #view: EditorView
  readonly #getPos: () => number | undefined
  readonly #actions: ImageActions
  readonly #read: (node: ProseNode) => ImageModel | null
  #node: ProseNode
  #model: ImageModel
  #source = ''

  constructor(
    node: ProseNode,
    view: EditorView,
    getPos: () => number | undefined,
    actions: ImageActions,
    read: (node: ProseNode) => ImageModel | null,
  ) {
    this.#node = node
    this.#view = view
    this.#getPos = getPos
    this.#actions = actions
    this.#read = read
    this.#model = read(node) ?? { src: '', alt: '', title: '', width: null, zoom: null, align: 'left' }
    this.dom.className = 'inkdown-image'
    this.#frame.className = 'inkdown-image-frame'
    this.#broken.className = 'image-broken'
    this.#size.className = 'image-size'
    this.#toolbar.className = 'image-toolbar'
    this.#toolbar.setAttribute('role', 'toolbar')
    this.#toolbar.setAttribute('aria-label', '图片操作')
    this.#image.draggable = false
    this.#image.addEventListener('load', () => this.dom.classList.remove('is-broken'))
    this.#image.addEventListener('error', () => this.dom.classList.add('is-broken'))
    this.#image.addEventListener('dblclick', () => this.#actions.open(this.#model.src))
    this.#frame.append(this.#image, this.#broken, this.#handle('left'), this.#handle('right'), this.#size, this.#toolbar)
    this.dom.append(this.#frame)
    this.#render()
  }

  update(node: ProseNode): boolean {
    if (node.type !== this.#node.type) return false
    const model = this.#read(node)
    if (!model) return false
    this.#node = node
    this.#model = model
    this.#render()
    return true
  }

  selectNode(): void {
    if (!this.#view.editable) return
    this.dom.classList.add('is-selected')
    this.#renderToolbar()
  }

  deselectNode(): void {
    this.dom.classList.remove('is-selected')
    this.#toolbar.replaceChildren()
  }

  stopEvent(event: Event): boolean {
    const target = event.target
    return target instanceof Element && (this.#toolbar.contains(target) || target.classList.contains('image-handle'))
  }

  ignoreMutation(): boolean {
    return true
  }

  destroy(): void {
    this.dom.remove()
  }

  #render(): void {
    const model = this.#model
    const source = this.#actions.resolve(model.src)
    if (source !== this.#source) {
      this.#source = source
      this.dom.classList.toggle('is-broken', !model.src)
      this.#image.src = source
    }
    this.#image.alt = model.alt
    this.#image.title = model.title
    this.#broken.textContent = `图片无法显示：${model.src || '图片地址为空'}`
    const percent = Boolean(model.width?.endsWith('%'))
    this.#frame.style.width = model.width ? (percent ? model.width : `${model.width}px`) : ''
    this.#image.style.width = model.width ? '100%' : ''
    this.#image.style.zoom = model.width ? '' : model.zoom ?? ''
    this.dom.dataset.align = model.align
    this.dom.classList.toggle('is-block', model.align !== 'left' || percent)
    if (this.dom.classList.contains('is-selected')) this.#renderToolbar()
  }

  #standalone(): boolean {
    const pos = this.#getPos()
    if (pos === undefined) return false
    const parent = this.#view.state.doc.resolve(pos).parent
    return parent.type.name === 'paragraph' && parent.childCount === 1
  }

  #button(label: string, svg: string, run: () => void, options: { active?: boolean; disabled?: boolean; title?: string } = {}) {
    const button = document.createElement('button')
    button.type = 'button'
    button.innerHTML = svg
    button.title = options.title ?? label
    button.setAttribute('aria-label', label)
    button.disabled = Boolean(options.disabled)
    if (options.active !== undefined) button.setAttribute('aria-pressed', String(options.active))
    button.addEventListener('click', (event) => {
      event.preventDefault()
      run()
    })
    return button
  }

  #renderToolbar(): void {
    const model = this.#model
    const standalone = this.#standalone()
    const local = isLocalImage(model.src)
    const alignButtons = (['left', 'center', 'right'] as const).map((align) => this.#button(
      alignLabels[align],
      icons[align],
      () => this.#commit({ ...model, align }),
      {
        active: model.align === align,
        disabled: !standalone,
        title: standalone ? alignLabels[align] : '图片单独成段时才能设置对齐',
      },
    ))
    const divider = () => Object.assign(document.createElement('span'), { className: 'image-toolbar-divider' })
    this.#toolbar.replaceChildren(
      ...alignButtons,
      divider(),
      this.#sizeMenu(model),
      divider(),
      this.#button('图片说明', icons.alt, () => this.#editAlt(), { title: '编辑图片说明（替代文字）' }),
      this.#button('替换图片', icons.replace, () => void this.#replace()),
      this.#button('打开图片', icons.open, () => this.#actions.open(model.src), { disabled: !model.src }),
      this.#button('在文件夹中显示', icons.reveal, () => this.#actions.reveal(model.src), { disabled: !local || !model.src }),
      this.#button('复制图片', icons.copy, () => this.#actions.copy(model.src), { disabled: !local || !model.src }),
      divider(),
      this.#button('删除图片', icons.remove, () => this.#remove()),
    )
  }

  /** Built from plain elements: Chromium paints the selection highlight over a native `<select>` inside a selected node. */
  #sizeMenu(model: ImageModel): HTMLElement {
    const menu = document.createElement('span')
    menu.className = 'image-size-menu'
    const trigger = document.createElement('span')
    trigger.className = 'image-size-trigger'
    trigger.tabIndex = 0
    trigger.title = '图片大小'
    Object.entries({ role: 'button', 'aria-label': '图片大小', 'aria-haspopup': 'menu', 'aria-expanded': 'false' })
      .forEach(([name, value]) => trigger.setAttribute(name, value))
    trigger.innerHTML = icon('<path d="m6 9 6 6 6-6"/>')
    trigger.prepend(describeSize(model))
    const list = document.createElement('span')
    list.className = 'image-size-options'
    list.setAttribute('role', 'menu')
    const current = model.width ?? ''
    const choices: Array<[string, string]> = [['', '原始大小'], ...IMAGE_SIZE_PRESETS.map((preset): [string, string] => [preset, `宽度 ${preset}`])]
    for (const [value, label] of choices) {
      const item = document.createElement('span')
      item.textContent = label
      item.tabIndex = -1
      item.setAttribute('role', 'menuitemradio')
      item.setAttribute('aria-checked', String(value === current && !(value === '' && model.zoom)))
      const choose = () => this.#commit({ ...model, width: value || null, zoom: null })
      item.addEventListener('click', choose)
      item.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        choose()
      })
      list.append(item)
    }
    const toggle = (open: boolean) => {
      menu.classList.toggle('is-open', open)
      trigger.setAttribute('aria-expanded', String(open))
      if (open) list.querySelector<HTMLElement>('[aria-checked="true"], [role="menuitemradio"]')?.focus()
    }
    trigger.addEventListener('click', () => toggle(!menu.classList.contains('is-open')))
    menu.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') toggle(false)
      else if (event.target === trigger && (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown')) toggle(true)
      else return
      event.preventDefault()
    })
    menu.append(trigger, list)
    return menu
  }

  #editAlt(): void {
    const input = document.createElement('input')
    input.value = this.#model.alt
    input.placeholder = '描述图片内容，供读屏和图片无法显示时使用'
    input.setAttribute('aria-label', '图片说明')
    const save = () => this.#commit({ ...this.#model, alt: input.value.trim() })
    const cancel = () => {
      this.#renderToolbar()
      this.#view.focus()
    }
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') save()
      else if (event.key === 'Escape') cancel()
      else return
      event.preventDefault()
    })
    this.#toolbar.replaceChildren(input, this.#button('保存说明', icons.check, save), this.#button('取消', icons.close, cancel))
    input.focus()
    input.select()
  }

  async #replace(): Promise<void> {
    const image = await this.#actions.choose()
    if (!image) return
    const generated = !this.#model.alt || /^image-\d+/.test(this.#model.alt)
    this.#commit({ ...this.#model, src: image.src, alt: generated ? image.alt : this.#model.alt })
  }

  #remove(): void {
    const pos = this.#getPos()
    if (pos === undefined) return
    this.#view.dispatch(this.#view.state.tr.delete(pos, pos + this.#node.nodeSize).scrollIntoView())
    this.#view.focus()
  }

  #commit(next: ImageModel): void {
    const pos = this.#getPos()
    if (pos === undefined) return
    const { state } = this.#view
    const replacement = isPlainImage(next)
      ? state.schema.nodes.image.create({ src: next.src, alt: next.alt, title: next.title })
      : state.schema.nodes.html.create({ value: imageHtml(next) })
    if (replacement.eq(this.#node)) {
      this.#renderToolbar()
      return
    }
    const tr = state.tr.replaceWith(pos, pos + this.#node.nodeSize, replacement)
    this.#view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, pos)))
    this.#view.focus()
  }

  #handle(side: 'left' | 'right'): HTMLElement {
    const handle = document.createElement('span')
    handle.className = 'image-handle'
    handle.dataset.side = side
    handle.title = '拖动调整大小，双击恢复原始大小'
    handle.addEventListener('pointerdown', (event) => this.#resize(event, handle, side))
    handle.addEventListener('dblclick', (event) => {
      event.preventDefault()
      if (this.#view.editable) this.#commit({ ...this.#model, width: null, zoom: null })
    })
    return handle
  }

  #resize(event: PointerEvent, handle: HTMLElement, side: 'left' | 'right'): void {
    if (event.button !== 0 || !this.#view.editable) return
    event.preventDefault()
    handle.setPointerCapture(event.pointerId)
    const start = this.#image.getBoundingClientRect().width
    const ratio = this.#image.naturalWidth ? this.#image.naturalHeight / this.#image.naturalWidth : 0
    const limit = this.dom.parentElement?.clientWidth || Number.POSITIVE_INFINITY
    const factor = (side === 'right' ? 1 : -1) * (this.#model.align === 'center' ? 2 : 1)
    let width = Math.round(start)
    this.dom.classList.add('is-resizing')
    const move = (moveEvent: PointerEvent) => {
      width = Math.round(Math.min(limit, Math.max(MIN_IMAGE_WIDTH, start + (moveEvent.clientX - event.clientX) * factor)))
      this.#frame.style.width = `${width}px`
      this.#image.style.width = '100%'
      this.#image.style.zoom = ''
      this.#size.textContent = ratio ? `${width} × ${Math.round(width * ratio)}` : `${width} px`
    }
    const end = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', end)
      handle.removeEventListener('pointercancel', end)
      this.dom.classList.remove('is-resizing')
      if (width !== Math.round(start)) this.#commit({ ...this.#model, width: String(width), zoom: null })
      else this.#render()
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', end)
    handle.addEventListener('pointercancel', end)
  }
}
