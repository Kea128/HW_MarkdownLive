import { Schema, type Node } from '@milkdown/kit/prose/model'
import { EditorState, NodeSelection } from '@milkdown/kit/prose/state'
import { EditorView, type NodeViewConstructor } from '@milkdown/kit/prose/view'

export const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'inline*', group: 'block', toDOM: () => ['p', 0] },
    text: { group: 'inline' },
    image: {
      inline: true,
      group: 'inline',
      atom: true,
      selectable: true,
      draggable: true,
      attrs: { src: { default: '' }, alt: { default: '' }, title: { default: '' } },
      toDOM: (node) => ['img', node.attrs],
    },
    html: {
      inline: true,
      group: 'inline',
      atom: true,
      attrs: { value: { default: '' } },
      toDOM: (node) => ['span', String(node.attrs.value)],
    },
  },
})

export const paragraph = (...content: Node[]) => schema.nodes.paragraph.create(null, content)
export const image = (src: string, alt = '') => schema.nodes.image.create({ src, alt })
export const html = (value: string) => schema.nodes.html.create({ value })
export const text = (value: string) => schema.text(value)

/** jsdom has no layout; ProseMirror only needs these to exist when scrolling the selection into view. */
export function stubLayout(): void {
  const rects = Object.assign([], { item: () => null })
  Range.prototype.getClientRects = () => rects as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
  Element.prototype.scrollIntoView = () => undefined
  Element.prototype.setPointerCapture = () => undefined
}

export function mountView(nodes: Node[], nodeViews: Record<string, NodeViewConstructor> = {}): EditorView {
  const host = document.createElement('div')
  document.body.append(host)
  return new EditorView(host, {
    state: EditorState.create({ doc: schema.nodes.doc.create(null, nodes) }),
    nodeViews,
  })
}

export function selectNodeAt(view: EditorView, pos: number): void {
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)))
}
