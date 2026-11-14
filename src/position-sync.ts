import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Selection, TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'

/** A place in the document plus where it sat on screen, carried across a switch between the two editors. */
export interface ViewAnchor {
  /** 1-based source line. */
  line: number
  /** Distance from the top of the viewport as a fraction of its height; negative when the line is above it. */
  ratio: number
}

/** The parts of an mdast node that position mapping reads. */
export interface MarkdownBlock {
  type: string
  position?: { start: { line: number }; end: { line: number } }
  children?: MarkdownBlock[]
}

export interface SourceMetrics {
  lineHeight: number
  paddingTop: number
}

const CONTAINERS = new Set(['root', 'list', 'listItem', 'blockquote', 'table', 'tableRow', 'footnoteDefinition'])

/** Children that become ProseMirror nodes in the same order; link definitions are kept as paragraphs of raw text. */
function blockChildren(node: MarkdownBlock): MarkdownBlock[] {
  return CONTAINERS.has(node.type) ? node.children ?? [] : []
}

/** Child indexes from the root to the deepest block containing `line`, or to the first block after it. */
export function blockPathAtLine(tree: MarkdownBlock, line: number): number[] {
  const path: number[] = []
  let node = tree
  for (let children = blockChildren(node); children.length > 0; children = blockChildren(node)) {
    const found = children.findIndex((child) => (child.position?.end.line ?? Number.POSITIVE_INFINITY) >= line)
    const index = found < 0 ? children.length - 1 : found
    path.push(index)
    node = children[index]
    if ((node.position?.start.line ?? line) > line) break
  }
  return path
}

export function lineAtBlockPath(tree: MarkdownBlock, path: readonly number[]): number {
  let node = tree
  let line = 1
  for (const index of path) {
    const child = blockChildren(node)[index]
    if (!child?.position) break
    line = child.position.start.line
    node = child
  }
  return line
}

export function lineAtOffset(text: string, offset: number): number {
  let line = 1
  for (let index = text.indexOf('\n'); index !== -1 && index < offset; index = text.indexOf('\n', index + 1)) line++
  return line
}

/** Offset where `line` starts; lines past the end resolve to the start of the last line. */
export function offsetAtLine(text: string, line: number): number {
  let offset = 0
  for (let current = 1; current < line; current++) {
    const next = text.indexOf('\n', offset)
    if (next === -1) break
    offset = next + 1
  }
  return offset
}

function lineText(text: string, line: number): string {
  const start = offsetAtLine(text, line)
  const end = text.indexOf('\n', start)
  return text.slice(start, end === -1 ? undefined : end)
}

const isFence = (line: string) => /^ {0,3}(?:`{3,}|~{3,}|\$\$)/.test(line)

/** The caret line when it is on screen, otherwise the first line in view. */
export function sourceAnchor(
  textarea: Pick<HTMLTextAreaElement, 'value' | 'selectionStart' | 'scrollTop' | 'clientHeight'>,
  { lineHeight, paddingTop }: SourceMetrics,
): ViewAnchor {
  const { value, selectionStart, scrollTop, clientHeight } = textarea
  const height = Math.max(clientHeight, 1)
  const caretLine = lineAtOffset(value, selectionStart)
  const caretTop = paddingTop + (caretLine - 1) * lineHeight - scrollTop
  if (caretTop >= 0 && caretTop + lineHeight <= height) return { line: caretLine, ratio: caretTop / height }
  const firstLine = Math.min(lineAtOffset(value, value.length), Math.max(1, Math.ceil((scrollTop - paddingTop) / lineHeight) + 1))
  return { line: firstLine, ratio: (paddingTop + (firstLine - 1) * lineHeight - scrollTop) / height }
}

export function sourceScrollTop(anchor: ViewAnchor, clientHeight: number, { lineHeight, paddingTop }: SourceMetrics): number {
  return Math.max(0, paddingTop + (anchor.line - 1) * lineHeight - anchor.ratio * clientHeight)
}

/** A zero-size box (CodeMirror hidden behind a diagram preview) has no meaningful position. */
const measuredTop = (element: Element | undefined): number | undefined => {
  const rect = element?.getBoundingClientRect()
  return rect && (rect.width > 0 || rect.height > 0) ? rect.top : undefined
}

const measure = (read: () => number | undefined): number | null => {
  try {
    return read() ?? null
  } catch {
    return null
  }
}

/**
 * CodeMirror renders code blocks itself, so ProseMirror can only place positions inside them at the block edge.
 * Blocks that have not scrolled into view yet are a plain `<pre>` placeholder until Crepe mounts CodeMirror.
 */
function codeLineTop(view: EditorView, blockPos: number, index: number): number | null {
  const dom = view.nodeDOM(blockPos)
  if (!(dom instanceof HTMLElement)) return null
  const lines = dom.querySelectorAll('.cm-line')
  if (lines.length) return measure(() => measuredTop(lines[Math.min(index, lines.length - 1)]))
  const placeholder = dom.querySelector('pre')
  if (!placeholder) return null
  const style = getComputedStyle(placeholder)
  const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.5 || 0
  return measure(() => placeholder.getBoundingClientRect().top + (Number.parseFloat(style.paddingTop) || 0) + index * lineHeight)
}

function firstVisibleBlock(view: EditorView, top: number): { pos: number; top: number } | null {
  const { doc } = view.state
  for (let index = 0, pos = 0; index < doc.childCount; pos += doc.child(index).nodeSize, index++) {
    const dom = view.nodeDOM(pos)
    if (!(dom instanceof HTMLElement)) continue
    const rect = dom.getBoundingClientRect()
    if (rect.bottom > top) return { pos, top: rect.top }
  }
  return null
}

/**
 * Source line of the caret, or of the first block on screen when the caret has scrolled away.
 * `tree` and `markdown` describe the same text, with front matter in its editor (fenced) form.
 */
export function visualAnchor(view: EditorView, tree: MarkdownBlock, markdown: string, viewport: DOMRect): ViewAnchor | null {
  const { doc, selection } = view.state
  let $pos = doc.resolve(selection.head)
  let inner = 0
  let top: number | null
  if ($pos.parent.type.spec.code) {
    inner = $pos.parent.textBetween(0, $pos.parentOffset).split('\n').length - 1
    top = codeLineTop(view, $pos.before(), inner)
  } else {
    top = measure(() => view.coordsAtPos(selection.head).top)
  }
  if (top === null || top < viewport.top || top > viewport.bottom) {
    const first = firstVisibleBlock(view, viewport.top)
    if (!first) return null
    $pos = doc.resolve(first.pos)
    inner = 0
    top = first.top
  }
  const path = Array.from({ length: Math.max(1, $pos.depth) }, (_, depth) => $pos.index(depth))
  let line = lineAtBlockPath(tree, path)
  if ($pos.depth > 0 && $pos.parent.type.spec.code) line += (isFence(lineText(markdown, line)) ? 1 : 0) + inner
  return { line, ratio: (top - viewport.top) / Math.max(viewport.height, 1) }
}

/** Puts the caret on the block that holds the anchor line and scrolls it to the same place on screen. */
export function revealAnchor(
  view: EditorView, tree: MarkdownBlock, markdown: string, anchor: ViewAnchor, scroller: HTMLElement,
): void {
  const path = blockPathAtLine(tree, anchor.line)
  let parent: ProseNode = view.state.doc
  let contentStart = 0
  let target: { node: ProseNode; pos: number; depth: number } | null = null
  for (const [depth, index] of path.entries()) {
    if (index >= parent.childCount) break
    let pos = contentStart
    for (let sibling = 0; sibling < index; sibling++) pos += parent.child(sibling).nodeSize
    const node = parent.child(index)
    target = { node, pos, depth: depth + 1 }
    if (node.isTextblock || node.isLeaf) break
    parent = node
    contentStart = pos + 1
  }
  if (!target) return

  const { doc } = view.state
  const { node, pos } = target
  let inner = 0
  let head = pos + 1
  if (node.type.spec.code) {
    const start = lineAtBlockPath(tree, path.slice(0, target.depth))
    inner = Math.max(0, anchor.line - start - (isFence(lineText(markdown, start)) ? 1 : 0))
    head += offsetAtLine(node.textContent, inner + 1)
  }
  const selection = node.isTextblock
    ? TextSelection.create(doc, Math.min(head, pos + 1 + node.content.size))
    : Selection.near(doc.resolve(node.isLeaf ? pos : pos + 1))
  view.dispatch(view.state.tr.setSelection(selection))

  const top = (node.type.spec.code ? codeLineTop(view, pos, inner) : measure(() => view.coordsAtPos(selection.head).top))
    ?? measure(() => (view.nodeDOM(pos) as HTMLElement | null)?.getBoundingClientRect().top)
  if (top === null) return
  const viewport = scroller.getBoundingClientRect()
  scroller.scrollTop += top - viewport.top - anchor.ratio * viewport.height
}
