import { imageInlineComponent, inlineImageConfig } from '@milkdown/kit/component/image-inline'
import type { Editor } from '@milkdown/kit/core'
import { uploadConfig } from '@milkdown/kit/plugin/upload'
import type { Node } from '@milkdown/kit/prose/model'
import type { NodeViewConstructor } from '@milkdown/kit/prose/view'
import { htmlSchema } from '@milkdown/kit/preset/commonmark'
import { $view } from '@milkdown/kit/utils'
import { parseHtmlImages } from './html-images'
import { markdownImagePath } from './image-source'

interface ImageOptions {
  resolve(source: string): string
  documentPath(): string | null
  pathForFile(file: File): string
}

const imageIcon = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" '
  + 'stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/>'
  + '<circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/></svg>'

const htmlImageView = (resolve: ImageOptions['resolve']) => $view(htmlSchema.node, (): NodeViewConstructor => (initialNode) => {
  const dom = document.createElement('span')
  let rendered: string | null = null
  const render = (node: Node) => {
    const value = String(node.attrs.value ?? '')
    if (value === rendered) return
    rendered = value
    const group = parseHtmlImages(value)
    dom.dataset.type = 'html'
    dom.dataset.value = value
    dom.className = group ? 'html-image' : ''
    if (group?.align) dom.dataset.align = group.align
    else delete dom.dataset.align
    if (!group) {
      dom.textContent = value
      return
    }
    dom.replaceChildren(...group.images.map((image) => {
      const element = document.createElement('img')
      element.src = resolve(image.src)
      element.alt = image.alt
      element.draggable = false
      if (image.title) element.title = image.title
      if (image.width) element.style.width = image.width
      if (image.height) element.style.height = image.height
      if (image.zoom) element.style.zoom = image.zoom
      return element
    }))
  }
  render(initialNode)
  return {
    dom,
    update: (node) => {
      if (node.type !== initialNode.type) return false
      render(node)
      return true
    },
    ignoreMutation: () => true,
  }
})

export function installImagePlugins(editor: Editor, options: ImageOptions): void {
  const imageSource = (file: File) => {
    const filePath = options.pathForFile(file)
    return filePath ? markdownImagePath(filePath, options.documentPath()) : URL.createObjectURL(file)
  }
  editor
    .config((ctx) => {
      ctx.update(inlineImageConfig.key, (value) => ({
        ...value,
        imageIcon,
        uploadButton: '选择图片',
        confirmButton: '确定',
        uploadPlaceholderText: '或粘贴图片链接',
        onUpload: async (file) => imageSource(file),
        proxyDomURL: options.resolve,
      }))
      ctx.update(uploadConfig.key, (value) => ({
        ...value,
        uploader: async (files, schema) => Array.from(files)
          .filter((file) => file.type.startsWith('image/'))
          .map((file) => schema.nodes.image.createAndFill({ src: imageSource(file), alt: file.name.replace(/\.[^.]+$/, '') }))
          .filter((node): node is Node => node !== null),
      }))
    })
    .use(imageInlineComponent)
    .use(htmlImageView(options.resolve))
}
