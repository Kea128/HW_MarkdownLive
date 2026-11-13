import { editorViewOptionsCtx, type Editor } from '@milkdown/kit/core'
import { uploadConfig } from '@milkdown/kit/plugin/upload'
import type { Node } from '@milkdown/kit/prose/model'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView, NodeView, NodeViewConstructor } from '@milkdown/kit/prose/view'
import { htmlSchema, imageSchema } from '@milkdown/kit/preset/commonmark'
import { $view } from '@milkdown/kit/utils'
import { parseHtmlImages } from './html-images'
import { htmlImageModel, markdownImageModel } from './image-model'
import { ImageView, type ImageActions } from './image-view'
import { imageFiles, isImageFile, shouldPasteImages, type StoredImage } from './paste-images'

export interface ImageOptions extends ImageActions {
  store(files: File[]): Promise<StoredImage[]>
}

export const IMAGE_MENU_ICON = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" '
  + 'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/>'
  + '<circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/></svg>'

/** Inserts images at `at` (a drop position) or the current selection, keeping each one selectable afterwards. */
export function insertImages(view: EditorView, images: StoredImage[], at?: number): void {
  if (!images.length || view.isDestroyed) return
  const { state } = view
  let tr = state.tr
  if (at !== undefined) tr = tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(at, tr.doc.content.size))))
  for (const { src, alt } of images) tr = tr.replaceSelectionWith(state.schema.nodes.image.create({ src, alt }), false)
  view.dispatch(tr.scrollIntoView())
  view.focus()
}

async function storeAndInsert(view: EditorView, files: File[], options: ImageOptions, at?: number) {
  const before = view.state.doc
  const images = await options.store(files)
  insertImages(view, images, at !== undefined && view.state.doc.eq(before) ? at : undefined)
}

const readMarkdownImage = (node: Node) => markdownImageModel(node.attrs)

const readHtmlImage = (node: Node) => {
  const group = parseHtmlImages(String(node.attrs.value ?? ''))
  return group?.images.length === 1 ? htmlImageModel(group.images[0], group.align) : null
}

/** HTML that is not a single image: several images, a line break, or raw markup shown as source. */
export class HtmlView implements NodeView {
  readonly dom = document.createElement('span')
  private readonly resolve: (source: string) => string

  constructor(node: Node, resolve: (source: string) => string) {
    this.resolve = resolve
    this.render(node)
  }

  update(node: Node): boolean {
    if (node.type.name !== 'html' || readHtmlImage(node)) return false
    this.render(node)
    return true
  }

  ignoreMutation(): boolean {
    return true
  }

  private render(node: Node): void {
    const value = String(node.attrs.value ?? '')
    const group = parseHtmlImages(value)
    this.dom.dataset.type = 'html'
    this.dom.dataset.value = value
    delete this.dom.dataset.align
    if (/^<br\s*\/?>$/i.test(value.trim())) {
      this.dom.className = 'html-break'
      this.dom.replaceChildren(document.createElement('br'))
    } else if (group) {
      this.dom.className = 'html-image'
      if (group.align) this.dom.dataset.align = group.align
      this.dom.replaceChildren(...group.images.map((image) => {
        const element = document.createElement('img')
        element.src = this.resolve(image.src)
        element.alt = image.alt
        element.draggable = false
        if (image.title) element.title = image.title
        if (image.width) element.style.width = image.width
        if (image.height) element.style.height = image.height
        if (image.zoom) element.style.zoom = image.zoom
        return element
      }))
    } else {
      this.dom.className = 'html-inline'
      this.dom.textContent = value
    }
  }
}

export function installImagePlugins(editor: Editor, options: ImageOptions): void {
  editor
    .config((ctx) => {
      // Direct view props run before Crepe's clipboard and upload plugins, which would insert unusable blob: URLs.
      ctx.update(editorViewOptionsCtx, (previous) => ({
        ...previous,
        handlePaste: (view, event, slice) => {
          if (previous.handlePaste?.(view, event, slice)) return true
          if (!shouldPasteImages(event.clipboardData)) return false
          void storeAndInsert(view, imageFiles(event.clipboardData), options)
          return true
        },
        handleDrop: (view, event, slice, moved) => {
          if (previous.handleDrop?.(view, event, slice, moved)) return true
          const files = moved ? [] : imageFiles(event.dataTransfer)
          if (!files.length) return false
          void storeAndInsert(view, files, options, view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos)
          return true
        },
      }))
      ctx.update(uploadConfig.key, (value) => ({
        ...value,
        uploader: async (files, schema) => (await options.store(Array.from(files).filter(isImageFile)))
          .map(({ src, alt }) => schema.nodes.image.create({ src, alt })),
      }))
    })
    .use($view(imageSchema.node, (): NodeViewConstructor => (node, view, getPos) =>
      new ImageView(node, view, getPos, options, readMarkdownImage)))
    .use($view(htmlSchema.node, (): NodeViewConstructor => (node, view, getPos) => readHtmlImage(node)
      ? new ImageView(node, view, getPos, options, readHtmlImage)
      : new HtmlView(node, options.resolve)))
}
